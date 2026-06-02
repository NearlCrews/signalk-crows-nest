# Geographic stale-while-revalidate cache (design)

Date: 2026-06-01
Status: approved, ready to implement
Goal: cut the delay in getting notes (POIs) onto the chart plotter, for three
observed pains: panning/zooming to a new area, cold start, and slow-source lag.

## Problem

Notes delivery is pull-based and synchronous within one HTTP request: a chart
plotter (Freeboard-SK, Open Binnacle, or Binnacle) polls the SignalK `notes`
provider with a viewport bbox, the notes-resource output calls the aggregate
`listPointsOfInterest(bbox, poiTypes)`, and the aggregate fans out to each
enabled source under a 5 s per-source timeout. Each at-runtime source either
hits its per-source bbox cache or makes an upstream round-trip (ActiveCaptain,
OpenSeaMap via Overpass, NOAA ENC via ArcGIS). USCG serves from an in-memory
index and is already instant.

Two properties of the current `src/shared/bbox-debounce.ts` cap its usefulness:

1. The cache key is the exact viewport rounded to four decimals (~11 m), so
   every pan or zoom past ~11 m is a guaranteed miss that blocks on upstream
   (capped only by the 5 s timeout) and, for a slow source, lands on the
   chart only on the next poll.
2. A miss is fully blocking: there is no "serve the last-known result for this
   area immediately, refresh in the background."

Enabling fact: the notes-resource output returns every POI the source yields
and never clips to the requested bbox (the chart renders only what is in view).
So fetching a SUPERSET of the viewport is correctness-safe. Verified in
`src/outputs/notes-resource/notes-resource-output.ts`.

## Design

Generalize the per-source bbox cache (`src/shared/bbox-debounce.ts`) into a
geographic stale-while-revalidate cache. The public `get` contract changes only
in that the `fetch` callback now receives the bbox to fetch. The three
at-runtime sources change one line each (use the bbox the cache hands them).
USCG, the aggregate registry, dedupe, the year filter, and the notes output are
untouched. Consumer-agnostic: stock Freeboard-SK and both binnacles benefit
without any change.

### 1. Snap to a tile grid (fixes pan/zoom)

Before fetching, the cache snaps the requested viewport OUTWARD to a grid of
`SNAP_DEGREES` (a module constant, default `0.1` degrees, about 11 km) and uses
that grid-aligned box as both the cache key and the bbox passed to `fetch`:

```
snapped = {
  south: floor(bbox.south / SNAP_DEGREES) * SNAP_DEGREES,
  west:  floor(bbox.west  / SNAP_DEGREES) * SNAP_DEGREES,
  north: ceil (bbox.north / SNAP_DEGREES) * SNAP_DEGREES,
  east:  ceil (bbox.east  / SNAP_DEGREES) * SNAP_DEGREES,
}
```

Two viewports that fall in the same tile share one upstream fetch, so a small
pan inside a tile is an instant hit. The fetched tile is a superset of the
viewport, which is safe because the notes output does not clip. `bboxKey`
already rounds to four decimals, so floating-point noise in the snapped edges
does not split keys.

Trade-off accepted: a pan that crosses a tile line still misses (a grid cliff).
The smoother alternative (margin-expand plus a containment scan) is deferred; it
needs non-string keying and antimeridian-containment handling. Snap-to-grid
reuses the existing keyed-LRU, in-flight-promise, and `shouldCache` machinery
and is exact (containment is automatic).

### 2. Stale-while-revalidate (fixes slow-source lag and cold-start-near-known)

Replace the binary fresh-hit / blocking-miss with three cases (mirrors the
bridge-clearance resolver's SWR pattern, including an injectable clock for
deterministic tests):

- Fresh (entry younger than `ttlSeconds`): return it.
- Stale (entry exists, past TTL): return it immediately AND kick one background
  refresh, guarded so concurrent ticks do not stack refreshes; the refresh
  updates the entry when it lands.
- Miss (no entry for the tile): fetch and await. This is the only remaining
  blocking path, a genuinely new area; concurrent callers still share the one
  in-flight promise.

Because stale entries must be servable, the LRU is used for size bounding only
(`max`, no library `ttl`); freshness is tracked manually with a stored
`freshAt` timestamp compared against an injectable `now()` (default `Date.now`).
The off-sentinel (`ttlSeconds <= 0`) still means "no cache": fetch the raw
viewport with no snap and no store.

`shouldCache` (the NOAA partial-result veto) is preserved: a non-cacheable
result is returned to the current waiters but not stored, so the next call
re-fetches.

### 3. Tunables

- `SNAP_DEGREES`: module constant, default `0.1`. Internal for now (not a
  config knob) to hold scope.
- `refreshSeconds` (existing per-source config): keeps its meaning as the
  freshness window; with SWR it governs revalidation cadence rather than how
  long until the caller blocks again.

### 4. Free side benefit

When the chart is near the vessel, the position-monitor scan (vessel-centered
bbox) and the notes request (viewport bbox) can snap to the same tile and share
the fetch for OpenSeaMap and NOAA (which ignore `poiTypes`, so their cache key
carries no discriminator). The scan then warms the notes path. ActiveCaptain
still keys on `poiTypes`, so it does not share, which is correct.

## Files

- `src/shared/bbox-debounce.ts`: internal rework (snap + SWR + injectable
  clock); `get`'s `fetch` callback gains a `fetchBbox` argument; add
  `SNAP_DEGREES` and a `snapBbox` helper.
- `src/inputs/active-captain/active-captain-source.ts`,
  `src/inputs/openseamap/openseamap-source.ts`,
  `src/inputs/noaa-enc/noaa-enc-source.ts`: each source's `bboxCache.get`
  fetcher uses the passed `fetchBbox` for its upstream query instead of the
  captured viewport.

## Tests (TDD)

- Two nearby viewports that snap to the same tile cause exactly one upstream
  fetch.
- A request just over a tile boundary causes a second fetch (the accepted
  cliff).
- A stale entry is served immediately and triggers a background refresh that
  updates it on the next read (injected clock advanced past the TTL).
- A genuine miss still blocks and caches; the in-flight dedup still collapses a
  concurrent same-tile burst into one fetch.
- The `shouldCache` veto still prevents caching a partial result.
- The off-sentinel (`refreshSeconds = 0`) still fetches the raw viewport every
  call with no snap.

## Risk

Moderate, contained to one shared module plus three one-line fetcher edits. No
new background loops, no new persistence, no consumer changes. All existing
bbox-cache tests must stay green, adapted only where they asserted exact-bbox
keying or library-`ttl` expiry that this design intentionally changes.

## Out of scope (possible follow-ups)

- Smoother containment-based reuse (margin-expand plus extent scan) instead of
  snap-to-grid.
- Proactive warming of an expanded tile around the served viewport or the
  vessel.
- OpenSeaMap disk persistence so a cold start paints from disk instead of a
  cold Overpass round-trip.
- Exposing `SNAP_DEGREES` (or a zoom-adaptive snap) as configuration.
