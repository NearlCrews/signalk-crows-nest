# Vector-tile water source for the channel router: design

Status: design, hardened after review and a live spike.
Date: 2026-06-15.

## Summary

Replace the channel router's live-Overpass `natural=water` and land fetch with the
pre-clipped `water` layer read from OpenMapTiles-schema vector tiles (the same
OpenFreeMap source Binnacle renders). This fixes the two worldwide gaps that 30 live
test routes exposed in the Overpass-polygon approach: large or long water bodies
timed out because Overpass `out geom;` returns full polygon geometry with no bbox
clip, and coastline-bounded water (the open sea, harbors, rias, and fjords) returned
nothing because OSM maps those only with `natural=coastline` lines, not a water
polygon. The vector-tile `water` layer covers ocean, lakes, and rivers as small
clipped per-tile polygons that carve out land and islands, worldwide.

A live spike validated the load-bearing assumption (see Empirical validation): with
the correct tile URL the `water` layer correctly reads Manhattan, Governors Island,
Alcatraz, Angel Island, and the Stockholm archipelago islands as land and the
surrounding water as water, at zoom 12 and 14. ENC charted depth stays primary and
authoritative for depth in US waters; tile-water is the worldwide, depth-unknown
coverage layer.

Coverage is worldwide but generalized. It widens where the router can run; it does
not make the router route everywhere or replace the chart. The honest limits, carried
inline so they are not missed: tile water is generalized per zoom, so a very narrow
channel can be merged shut (the router declines there) and a small island or rock can
be generalized away at low zoom (the router has no land signal there); a failed tile
leaves its area uncovered (decline there); and tile-water carries no depth (the safety
check owns depth). The router never returns a leg that leaves the mapped water; it
declines instead. The post-route safety check (ENC `Land_Area` and OSM coastline) is
an independent, deliberate backstop for a small island the generalized tile omitted.

## Problem

The channel router builds a navigable grid from positive water sources. ENC charted
`Depth_Area` polygons cover US waters with depth. Outside ENC, the router fetched OSM
`natural=water` polygons from live Overpass. Live testing over 30 routes found two
hard limits in that path:

- Big-water fetch timeouts. Overpass `out geom;` returns a matched polygon's FULL
  geometry with no bbox clip, so a large lake or long river returns megabytes and
  exceeds the interactive fetch budget (Lake Geneva ~15 s, Venice ~24 s, Stockholm
  ~16 s, the Amazon, the Rhine, Gatun Lake). The route declines.
- Coastline-bounded water. OSM maps the open sea and many harbors, rias, and fjords
  only with `natural=coastline` lines, not a `natural=water` polygon, so the
  coverage-positive mask finds nothing (Sydney Harbour, Oslofjord, Auckland, the
  IJsselmeer). The route declines.

Both trace to one root cause: fetching water as full polygons from live Overpass. A
pre-clipped, pre-resolved water layer removes both at once.

## Empirical validation (spike)

A throwaway spike (decoder unsaved, no committed code) fetched real OpenFreeMap tiles
and tested known points against the decoded `water` layer:

- The bare `https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf` path now returns an
  empty 200. The live tiles are at a VERSIONED build path the style's TileJSON
  advertises (for example `.../planet/20260607_080001_pt/{z}/{x}/{y}.pbf`). The build
  path ages out when OpenFreeMap rebuilds the planet, so the design must resolve the
  tile template from the TileJSON, not hardcode it. Binnacle's own caching code
  already notes this aging behavior.
- The `water` layer is present at zoom 0 to 14 and correctly carves land and islands:
  Manhattan, Governors Island, Alcatraz, Angel Island, and Stockholm's Djurgarden
  read as land (not in water), and the Hudson, the bay, and Saltsjon read as water,
  at both z12 and z14. So islands are excluded from the water polygons, not hidden
  inside a water blob. This refutes the chief review concern, with the verification
  the reviewers correctly demanded.
- The working decoder pairing is `@mapbox/vector-tile@2` with `pbf@3` (the default
  `Pbf` constructor). The newer `pbf` (v4 and v5) split its export to `PbfReader` and
  does not pair with `@mapbox/vector-tile@2`; the versions must be pinned and the
  import shape verified at build time.
- Tile bytes may be gzip-encoded on the wire; the client must handle both encoded and
  plain bytes.

## Decisions

- **Vector-tile water replaces the router's Overpass water and land fetch.** The tile
  `water` layer carries ocean, lakes, and rivers as polygons that exclude land and
  islands, so it supersedes both the OSM `natural=water` query and the OSM land query
  in the router. ENC stays primary in US waters. The safety check keeps its own OSM
  coastline, seamark, and hazard checks unchanged; this design touches only the
  router's water source.
- **Resolve the tile URL from the style TileJSON, cached and re-resolved on age-out.**
  The default style is OpenFreeMap "liberty"; the source is configurable.
- **Decode with `@mapbox/vector-tile@3` plus `pbf@5`,** the verified pairing (both
  expose named exports, `VectorTile` and `PbfReader`, which import cleanly under both
  the CJS build and the tsx test runner with no default-export interop quirk), using
  the decoder's own `feature.toGeoJSON(x, y, z)` for ring grouping and the
  tile-to-lon/lat transform (it classifies exterior rings and holes by signed area in
  tile space, handling the y-down winding correctly, and applies the inverse-Mercator
  latitude). Do NOT hand-roll ring grouping or the transform off raw `loadGeometry`.
- **Reuse the project's `lru-cache`** (already a dependency, used in five places) for
  the tile cache, keyed by `z/x/y` (re-key with the layer name if the cache is ever
  shared beyond water), bounded by a byte budget, not only an entry count.
- **A dedicated tile-client HTTP profile, NOT the Overpass etiquette throttle.** Tiles
  are CDN assets: `minDelayMs: 0`, `maxConcurrency` about 6 to 8, a tight per-tile
  `requestTimeoutMs` (about 5 s), and `maxRetries: 1` (a tile is best-effort and
  tolerated on failure). Inheriting the Overpass `minDelayMs: 1000` would serialize
  16 tiles to 15 s and make this slower than the path it replaces.
- **Adaptive zoom, capped tile count, with per-tile and total vertex caps** to bound
  decode and rasterization cost on the Pi (mirroring the caps `osm-water-query.ts`
  carries today, which a prior uncapped diagnostic proved necessary).
- **Best-effort with the existing graceful degrade.** A failed tile leaves its area
  uncovered (decline there); all tiles failing is `fetch-failed` and the LLM route is
  kept with a note.

## Architecture and components

Two new modules, a swap in the orchestrator, one change to the re-check, and a
removal of the now-superseded Overpass water code. Each file has one responsibility.

- `src/inputs/vector-tiles/vector-tile-client.ts` (new) — thin HTTP and decode.
  `createVectorTileClient(log, options?)` returns
  `{ resolveTemplate(styleUrl, signal?), fetchLayer(template, z, x, y, layerName, signal?), close() }`.
  `resolveTemplate` fetches the style JSON, follows its vector source `url` to the
  TileJSON, and returns the current tile template (cached, re-resolved when a tile
  fetch 404s or returns empty, which signals an aged-out build). `fetchLayer` fetches
  the tile over the shared `http-client` with the dedicated tile profile and a
  descriptive `User-Agent`, reads the body as bytes (`new Uint8Array(await
  response.arrayBuffer())` AFTER `assertResponseOk`), gunzips when the gzip magic is
  present, decodes with `new VectorTile(new Pbf(bytes))`, and returns the named
  layer's features (or an empty list when the layer is absent). Rejects on HTTP,
  network, or decode failure. Owns no tile math and no projection.
- `src/route-draft/channel-router/tile-water-query.ts` (new) — the router's water
  source. `queryTileWater(client, template, bbox, signal?, logger?): Promise<TileWater>`
  where `TileWater = { water: AreaPolygon[] }` and `AreaPolygon = { rings:
  number[][][] }` (outer first, then island holes; the same structural shape
  `nav-grid` consumes, no ENC-type import). It: selects the zoom, enumerates the
  covering tiles, fetches and decodes the `water` layer of each concurrently (the
  tile-client profile bounds concurrency) with per-tile tolerance, converts each
  feature via `toGeoJSON` to lon/lat polygons (a MultiPolygon feature yields several
  `AreaPolygon`s), and returns the water polygons, applying the vertex caps. The
  `lru-cache` keyed by `z/x/y` caches the decoded per-tile water polygons across
  requests, bounded by a total-byte budget. Rejects only when every covering tile
  failed. Does NOT use `shared/bbox-tiles.ts` (that is the Overpass degree-tiling
  helper; this uses Web-Mercator XYZ tiles).
- `src/route-draft/channel-router/channel-router.ts` (modify) — the injected
  `queryWaterAreas` (Overpass) and `overpass` client become a `vectorTileClient` plus
  `queryTileWater` and the resolved template. The tile-water result feeds the grid's
  `osmWater` input; `osmLand` is empty (the water layer already excludes islands).
  Remove the `landIncomplete` guard and the `coverage-incomplete` decline reason (no
  land cap exists for tile-water). The re-check changes (below). The deadline,
  `fetch-failed`, `no-coverage`, snapping, A*, simplify, and fallback flow are
  otherwise unchanged. `usedOsmWater` is renamed `usedTileWater` (same meaning) on the
  result type, the helper, and the endpoint read site.
- Removals: `src/route-draft/channel-router/osm-water-query.ts` and its test; the
  overpass-client `listWaterAreas`, `buildWaterAreaQuery`, `parseWaterElement`,
  `osmAreaKind`, `geometryPoints`, `WATER_QUERY_TIMEOUT_SECONDS`, the `OsmArea*`
  types, the `listWaterAreas` interface member and returned-object entry, and the
  `listWaterAreas` assertions and stub entries in the overpass-client test. The
  safety check uses `listCoastlineWays` and `listPointsOfInterest` only, so this is
  safe (verified by grep: no other consumer).
- `src/route-draft/channel-router/index.ts` (modify) — export `queryTileWater` and
  `TileWater`/`AreaPolygon` from `./tile-water-query.js` instead of from
  `./osm-water-query.js`; drop the removed exports.
- `src/route-draft/config.ts` (modify) — add the configurable style URL (default the
  OpenFreeMap liberty style) as a named constant and config key, alongside the
  existing Overpass endpoint config.
- `src/route-draft/endpoint.ts` (modify) — build or hold the `vectorTileClient` on the
  service, resolve the template, and pass `queryTileWater`, the client, and the
  template into `routeChannel` instead of `queryWaterAreas` and `overpass`. The safety
  check keeps its own `overpass` (independent). The depth caveat path is unchanged
  except the symbol rename and the wording fix (below). Remove the
  `coverage-incomplete` entry from `CHANNEL_NOTE_BY_REASON`.

## Tile selection and transform

Web-Mercator XYZ. The covering tiles for `bbox` at zoom `z` are the integer ranges
`[lon2tile(west) .. lon2tile(east)] x [lat2tile(north) .. lat2tile(south)]`. Adaptive
zoom: choose the highest `z` in `[MIN_ZOOM, MAX_ZOOM]` whose covering-tile count is at
most `MAX_TILES`. `MAX_ZOOM = 14` (the layer's max, about a 2 km tile, detailed near
shore), `MAX_TILES = 16`, `MIN_ZOOM = 8`. The router bbox is already gated by
`resolveGridSize` (a meters-based cap, roughly 1.1 degrees of longitude at the
equator and less toward the poles), so a small harbor lands near z14 and the largest
routable bbox near z10. Because Mercator tile height in degrees shrinks toward the
poles, a high-latitude route of the same physical size needs more tiles and may drop
a zoom; the plan must verify the worst-case zoom at high latitude (Oslofjord,
Stockholm) stays at or above `MIN_ZOOM`. The `MIN_ZOOM` decline is a defensive
backstop, effectively unreachable for any bbox the orchestrator passes (it declines
oversized bboxes before fetch), and a test asserts a router-legal bbox never hits it.

Transform and ring grouping use `feature.toGeoJSON(x, y, z)` from the decoder, which
returns Polygon or MultiPolygon coordinates already in lon/lat with rings correctly
classified into exterior plus holes. The MVT buffer (geometry slightly beyond the
tile extent) is harmless: the grid clips to the bbox, and the transform must not clamp
buffer coordinates. Each tile's water is clipped to the tile, so adjacent tiles tile
the water continuously; emit per-tile polygons and let the grid rasterize each.

## Mask integration and the safety re-check

The grid is unchanged in structure. Tile-water polygons feed `osmWater` (islands as
holes, resolved by the even-odd scanline fill), `osmLand` is empty, and the ENC bands
stay primary with finest-band-wins. A cell not inside any water polygon is not covered
and therefore not navigable, so A* routes only on water and never onto an island
(the spike confirms islands are excluded from the water polygons). In US waters ENC
owns depth; tile-water adds worldwide coverage and fills any ENC gaps.

The final-leg re-check changes, because the current exact-only test against ENC land
rings does not cover tile-water, and an exact test against tile-water OUTER rings
would false-positive at tile-clip seams. The re-check becomes:

1. Exact (`segmentCrossesRings`), kept and extended: no final leg may cross an ENC
   `Land_Area` ring, an ENC drying-area ring, OR a tile-water HOLE ring (an island
   fully within a tile). Holes are interior features, not tile-edge artifacts, so the
   exact test has no seam false positive and catches a thin island the sampler could
   straddle.
2. Sampled, re-introduced for the coast and tile seams: every sampled point along
   each final leg must be navigable at full polygon resolution, defined as inside an
   ENC deep-enough `Depth_Area` OR inside a tile-water polygon and not in a hole, and
   not inside an ENC land or drying area. Spacing is `min(grid.cellMeters / 2,
   SAMPLE_CAP_METERS)` with `SAMPLE_CAP_METERS = 30`, so on a coarsened grid the
   sampling does not widen past a fixed bound. The sampled test treats a tile seam as
   in-water (a sampled point on the seam is inside the water polygon), catches a real
   coast (a sample on land is outside all water), and catches a seam-straddling
   island (its cells are outside water in both tiles). It is correct here, where ENC
   plus continuous tile-water leaves no coverage gaps to over-decline on, unlike the
   ENC-only case the sampled test was previously removed for.

The ENC-deep predicate used by the sampled re-check and by `usedTileWater` is the
identical function and contour, so a leg routed on tile-water (including a tile-water
fill of an ENC gap) is always marked depth-unverified and is never presented as
depth-checked because ENC happened to cover its endpoints.

Residual, documented honestly: a land neck narrower than `SAMPLE_CAP_METERS` that is
not an island hole (a thin spit at the coast) can fall between samples, and a small
island generalized away from the tile at the chosen zoom leaves no land signal at all.
Both are below the system's resolution, the same class as the existing sub-cell limit,
and both fail toward "no land signal," so the router can route across them. The
backstop is the post-route safety check, whose land sources (ENC `Land_Area`, OSM
coastline) are independent of the tile source, plus the route-level honesty note. The
router does not claim to catch these; the note (below) tells the navigator.

## Availability, caching, and honesty

The tile source is online, like the basemap. A failed tile contributes no water, so
its area is uncovered and the router declines there (`no-path` or `no-coverage`); when
every covering tile fails the source rejects and the orchestrator maps it to
`fetch-failed`, keeping the LLM route with the geometry note, the same degrade as
today. A partially-failed tile set is a known-incomplete picture: a failed tile next
to a succeeded one can drop a seam island, which is covered by the independent safety
check and the honesty note, not silently passed as water.

The `lru-cache` holds decoded per-tile water polygons, bounded by a total-byte budget
(evict least-recently-used until under, for example, 32 to 64 MB) rather than only an
entry count, so a worst-case dense tile cannot blow memory on the Pi. It holds water
EXTENT only, never depth or hazards, so a stale tile cannot mask a new shoal or hazard
(those are never in the tile) and land/water boundaries change slowly enough that a
session-lifetime in-memory cache carries no safety risk. The future on-disk cache
(out of scope) MUST carry an expiry.

The depth-unverified caveat is preserved. A route drawn from tile-water is
land-avoiding within the mapped, generalized water but is depth-unverified, so the
caveat fires whenever `usedTileWater` is true. Its wording is corrected from the
OSM-era text: do not say "it avoids charted land" (an overclaim against generalized
data); say it is "routed to stay within mapped water outlines, which are generalized
for display and can omit a small island or narrow hazard, so treat the track as a
draft and verify every leg against the chart, especially in narrow or shoal water."
Attribution: OpenFreeMap serves OpenStreetMap-derived OpenMapTiles data, so the
plugin docs and any tile-water-sourced output carry the OpenStreetMap (ODbL) and
OpenMapTiles attribution.

## Performance on the Pi

The router runs concurrently with ENC and before the safety check, gated by
`ROUTER_MIN_BUDGET_MS`. Tile-water is a large win over Overpass only with the
dedicated HTTP profile: 16 small CDN tiles at concurrency 6 to 8, `minDelayMs: 0`, and
`maxRetries: 1` complete in roughly 0.5 to 1.5 s warm, versus the multi-second
Overpass full-polygon fetches. The decode is synchronous CPU work on the in-process
event loop, bounded by the per-tile vertex cap (decimate a ring above the cap, since a
tile is far coarser than the grid cell resolves) and the total-vertex cap; decode is
interleaved with the tile fetches rather than batched after, to spread the bursts. The
scanline fill keeps its per-row deadline check, and the total-vertex cap bounds its
aggregate work. The cold-region first request (empty cache, cold CDN edge) is the real
worst case; the per-tile timeout and `maxRetries: 1` bound it, and the all-fail degrade
keeps it safe. Live verification must include a genuinely cold-region measurement, not
only warmed re-runs. The safety check keeps its own deadline and abort, so the
original safety-check-timeout fix stands regardless of router speed; the budget win is
contingent on the concurrency profile, so the plan must set it explicitly.

## Dependency choice

`@mapbox/vector-tile@^3` and `pbf@^5` are the verified, canonical MVT decode stack.
Both expose NAMED exports (`import { VectorTile } from '@mapbox/vector-tile'`,
`import { PbfReader } from 'pbf'`), which the spike confirmed import and decode a live
tile cleanly under both the CJS build and the tsx test runner, sidestepping the
default-export interop quirk an older `pbf` triggered. `@mapbox/vector-tile` pulls
`@mapbox/point-geometry` transitively (no direct add), and `@types/geojson` arrives
transitively for the `toGeoJSON` return type; both ship their own `.d.ts`. Licenses
are permissive (BSD-3-Clause and ISC), and a fresh install reported zero
vulnerabilities. A hand-written MVT decoder is rejected: protobuf varint, the geometry
command and zigzag decoding, and the ring classification are error-prone to own and
re-verify, exactly the case the project's adopt-a-library rule covers. The plan must
run `npm audit --omit=dev` and record it (a scored registry gate) and confirm CI
passes on the Node matrix. The comparison is recorded for the commit and CHANGELOG.

## Error handling and edge cases

- A tile with no `water` layer decodes to zero water features; its area is not
  covered, hence not navigable (correct).
- A degenerate, antimeridian, or too-large bbox is declined before any fetch by
  `resolveGridSize` in the orchestrator; the tile enumeration runs only for a
  resolvable bbox.
- A decode error or empty body on one tile is tolerated (no water there, logged); an
  empty body across the board signals an aged-out template, so `resolveTemplate`
  re-resolves once and retries before giving up.
- The layer `extent` is read per layer (the decoder applies it); not assumed.

## Testing

- `vector-tile-client`: decode a small committed real fixture tile (clipped to a tiny
  area) and assert the `water` layer feature count and that geometry decodes; gzip and
  plain bodies both decode; an HTTP non-ok status rejects; an aborted signal rejects;
  `close()` aborts; `resolveTemplate` parses a fixture style/TileJSON to the template
  and re-resolves on an empty-tile signal.
- `tile-water-query`: adaptive-zoom selection across bbox spans and latitudes (highest
  zoom under the cap, never below `MIN_ZOOM` for a router-legal bbox); tile
  enumeration covers the bbox; a stubbed client returns features that become polygons
  with island holes (including a MultiPolygon feature); a failed tile is tolerated and
  the rest return; an all-failed set rejects; the vertex caps decimate a dense ring;
  an `lru-cache` hit avoids a second client call.
- `channel-router` with a stubbed tile-water source: a coastline-bounded case (ocean
  as a water polygon) yields a water path; the re-check rejects a leg crossing an
  island hole (exact) and a leg leaving the water at a real coast (sampled), and
  accepts a leg crossing a tile seam in open water; `usedTileWater` is set when the
  path used tile-water and not ENC depth, sharing the ENC-deep predicate with the
  re-check.
- `endpoint`: the corrected depth caveat attaches on a tile-water success; the
  `coverage-incomplete` reason and note are gone; note merging and budget skip
  unchanged. Prune the overpass-client `listWaterAreas` test and the
  `osm-water-query` test.
- Live verification: re-run the worldwide routes that declined (Sydney, Oslofjord,
  Lake Geneva, the Amazon, the Rhine, Gatun Lake, the IJsselmeer) and a cold-region
  first request, plus a US re-confirm (Detroit, SF Bay), reporting how many route, the
  warm and cold fetch times, and that no returned leg crosses land.

## Out of scope (future)

- A persistent on-disk tile cache (the in-memory `lru-cache` is v1); it must carry an
  expiry.
- Sharing the tile-water and ENC fetch with the safety check (the long-noted check
  batching); this design leaves the safety check's fetches untouched, which also gives
  an independent land backstop.
- A depth filter outside ENC (tile water has no depth; EMODnet and ENC remain the
  depth sources).
- Any change to Binnacle's client rendering; this is a server-side router data source.
