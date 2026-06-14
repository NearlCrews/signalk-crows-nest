# Worldwide route-draft safety check

Date: 2026-06-14
Status: approved direction, design revised after review, pending implementation plan

Revision note: the region model changed from exclusive pick-one-region to a
per-leg union of every provider whose coverage envelope intersects the leg, and
several external-data and client details were corrected against the live EMODnet
and Overpass services. See "Region resolution" and "Open questions resolved".

## Problem

The AI route-draft endpoint (`POST /api/route-draft`) checks a drafted route's
legs against NOAA ENC charted depth-area contours, charted land, and charted
point hazards. That check is bound to NOAA ENC Direct, which covers US waters
only. Today `checkLegs` (in `src/route-draft/safety-check.ts`) refuses the whole
route the moment any waypoint falls outside US waters: it returns a single note,
"depth and hazards unavailable: route is outside US ENC coverage," with
`checked: false`. The model's waypoints still come back, but nothing verifies
depth, land, or hazards anywhere outside the US.

The plugin already imports worldwide marine data through OpenSeaMap (OpenStreetMap
via Overpass), where `rock`, `wreck`, and `obstruction` seamarks are already
classified as `Hazard` and flow through the same `scanRouteCorridor` the ENC
hazard scan uses. That capability is not plumbed into the route-draft check.

## Goal

Extend the route-draft safety check beyond US waters so that, for any drafted
route worldwide, the check runs every data provider available for each leg and is
explicit about every dimension it could not verify. A route is never silently
passed.

Decided scope:

- Worldwide point hazards from OpenSeaMap seamarks.
- Worldwide land crossing from the OpenStreetMap coastline.
- European-seas depth from EMODnet bathymetry, treated as awareness-grade
  modeled data, not authoritative charted depth.
- Provider selection resolved per leg by the union of intersecting coverage
  envelopes.
- Fully automatic: no new panel configuration.

## Non-goals

- Authoritative non-US depth. No free global hydrographic depth-area service
  exists. EMODnet is a modeled terrain grid, not a navigational chart, and is
  surfaced as such.
- Global depth outside European seas. GEBCO is too coarse for navigation and is
  not used.
- A new POI source or a new npm package. This extends the existing route-draft
  internal capability, consistent with the one-plugin, modular-files rule.
- Any change to the model prompt, the fuel estimate, or the route response shape
  beyond the flag set the check already produces.

## Approach

Refactor the ENC-specific `checkLegs` into a region-aware, capability-based
provider model. The current `isInUsWaters` whole-route gate is replaced by a
per-leg resolver over a small set of providers, each declaring which dimensions
(depth, land, hazards) it supplies and the geographic envelope it covers.

Two alternatives were considered and rejected:

- Inline branches inside the current `checkLegs`. Faster to write, but it grows
  an already large ENC-specific file into a tangle of three providers' logic and
  fails the isolation test.
- A single provider chosen for the whole route. Rejected in favor of per-leg
  resolution so a route straddling regions is checked correctly on each part.

## Architecture

`checkLegs` becomes a thin orchestrator. For each leg it asks a region resolver
which providers apply, runs each provider's per-leg depth and land checks, runs
the hazard scan once per provider over the legs that provider covers, and emits
an explicit "not checked" flag for any dimension no responsible provider
verified on that leg. The existing bounded-concurrency leg pool, the request
deadline, and abort-on-timeout are preserved and extended to every provider.

### Provider interface

```
type Coverage = 'data' | 'nodata'   // a responsible provider returned data, or returned none

interface LegDimensionCoverage { depth?: Coverage, land?: Coverage }

interface LegSafetyProvider {
  id: string
  capabilities: ReadonlySet<'depth' | 'land' | 'hazards'>
  // Raw geographic footprint of this provider, used by the resolver. OSM is global.
  coversLeg (from: Position, to: Position): boolean
  // Per-leg depth and land flags, plus which of its own dimensions returned data.
  checkLeg (leg: number, from: Position, to: Position, params: LegCheckParams):
    Promise<{ flags: LegFlag[], coverage: LegDimensionCoverage }>
  // Hazard sweep over the global legs this provider covers; returns flags carrying
  // GLOBAL leg indices. Present only when capabilities has 'hazards'.
  checkHazards? (legs: LegRef[], params: LegCheckParams): Promise<LegFlag[]>
}

// A covered leg with its global index and endpoints, handed to checkHazards so a
// corridor hit maps back to the right global leg.
interface LegRef { leg: number, from: Position, to: Position }
```

`checkLeg` returns per-dimension coverage so the orchestrator can decide
not-checked emission without parsing message strings. `capabilities` is the
single signal for which dimensions a provider supplies; the optional
`checkHazards` is present exactly when `capabilities` contains `hazards`. The
orchestrator holds the injected providers, the same dependency-injection shape
the current check uses so tests stub upstream clients without live HTTP.

### Region resolution

The resolver is the single owner of the active provider set per leg. Each
provider exposes only its own raw footprint; the resolver computes, per leg, the
union of every provider whose envelope intersects the leg:

- ENC is a candidate when the leg intersects the US ENC envelope.
- EMODnet is a candidate when the leg intersects the EMODnet European envelope.
- OpenSeaMap is a candidate on every leg (its footprint is global).

This is a deliberate change from an exclusive single-region model. The US ENC
envelope (`isInUsWaters`) is intentionally generous, so an exclusive gate would
suppress the worldwide OpenSeaMap check on real foreign water inside that box
(Miami to Bimini, the BVI, the Canadian Maritimes, the Great Lakes, the Gulf
approaches), and a leg straddling the US boundary would drop ENC on its
in-coverage half. The union prevents both. ENC is queried only where its
envelope plausibly covers, so a clearly-foreign European leg never pays
speculative ENC latency, and OpenSeaMap is the worldwide safety net that closes
the generous-envelope gap.

Authority and de-duplication where envelopes overlap (a US nearshore leg with
both ENC and OSM data):

- Depth: ENC charted DRVAL1 is authoritative. EMODnet and ENC envelopes barely
  overlap; if both ever return depth on one leg, ENC wins and EMODnet is dropped
  for that leg.
- Land: ENC charted land areas are authoritative. An OSM coastline crossing on a
  leg that also crosses ENC charted land is deduped to the ENC land flag.
- Hazards: ENC and OSM hazards are merged and deduped by rounded position and
  type (the same approach as `dedupe-pois.ts`), preferring the ENC feature, so a
  wreck charted by both is flagged once.

Region precedence is explicit and deterministic (US ENC, then EMODnet, then
OpenSeaMap) so any future envelope overlap resolves predictably.

### Not-checked contract

The orchestrator keys not-checked emission off provider responsibility
(capabilities), never off whether a flag came back:

- A dimension verified with data and clean yields NO flag. This preserves
  today's implicit pass within the stated caveat (a clean ENC leg adds no flag).
- A dimension a responsible provider could not read (its `coverage` is `nodata`,
  or an empty or rejected upstream response) yields an explicit "not checked"
  flag for that dimension.
- A dimension no provider on the leg is responsible for (depth outside the US and
  EMODnet envelopes) yields an explicit "not checked" flag.

Identical not-checked flags are deduped per dimension per provider-region rather
than emitted once per leg, so a long foreign route does not flood the response
with one flag per leg. The flag list shape is unchanged; only the count grows
relative to today's single refusal, and the Binnacle client tolerates the larger
ordered set.

## Components

### Orchestrator (`src/route-draft/safety-check.ts`)

Owns the route polyline, the per-leg provider resolution, the bounded-concurrency
leg pool, the per-provider hazard sweep, the global leg indexing
(`cumulativeLegStartMeters`, `legForAlongTrack` stay here so a corridor hit maps
to a global leg regardless of which provider-region subset it scanned), the
deadline, and the abort controller. It assembles flags, applies `orderFlags`,
and returns `LegCheckResult`. `LegCheckResult.checked` stays internal (the
endpoint reads only `flags`) and means "at least one dimension on at least one
leg was verified with data".

### EncProvider (`src/route-draft/providers/enc-provider.ts`)

Today's logic, extracted with behavior preserved: depth-area DRVAL1 contours
(shallowest navigable across bands), drying areas, charted land areas, standoff,
and the wreck, obstruction, and rock corridor scan. The `EncDirectClient`,
`queryChartedAreas`, and the band sweep move here. It reports `coverage.depth`
and `coverage.land` per leg.

### OpenSeaMapProvider (`src/route-draft/providers/openseamap-provider.ts`)

- Hazards: `scanRouteCorridor` over OpenSeaMap `rock`, `wreck`, and `obstruction`
  seamarks. The hazard filter is hard-coded to those three seamark types and is
  independent of the panel's configured `seamarkGroups`, so a user who disabled
  the hazards group for display does not lose the route-draft hazard check.
- Land: a `natural=coastline` Overpass query (see Coastline query). The leg
  crosses land when any leg sub-segment crosses any coastline segment, tested
  with a polyline (non-closing) segment-cross helper. Standoff uses point-to-
  segment distance between each leg sub-segment and each coastline sub-segment,
  not vertex-only nearest approach, because OSM coastline ways have long sparse
  segments where vertex sampling would miss a close pass. The flag states a
  coastline crossing and that absence of a crossing is never proof of clear
  water; it never asserts a point is on land.
- Depth: not a capability. An OpenSeaMap-only leg always emits an explicit
  "depth not checked" flag, unconditionally, and never inherits the ENC
  land-crossing-suppresses-no-depth behavior (an ENC land crossing makes depth
  moot, an OSM coastline crossing does not).
- Reports `coverage.land` per leg.

### EmodnetProvider (`src/route-draft/providers/emodnet-provider.ts`)

One `GET /depth_profile?geom=LINESTRING(lon lat, lon lat)` request per EU leg,
built from the leg endpoints alone (the service self-densifies at the roughly
115 m DTM grid, so client-side pre-densification with `sampleRhumbLeg` is
redundant). The response is a flat JSON array of signed depth values or nulls,
one per DTM cell, in meters, referenced to Lowest Astronomical Tide (LAT). The
shallowest navigable reading on the leg is `max()` of the non-null values
(negative below datum, so the value closest to zero is shallowest).

- A positive sample is an above-datum elevation, drying or land, not a depth. It
  is flagged as drying or land in the manner of the ENC drying-area path, never
  reported as a clearing depth.
- When any cell on the leg is null, a "modeled depth incomplete, gaps not
  checked" caveat is emitted alongside any reading, so a partial profile cannot
  pass over an unsampled shoal.
- Every EMODnet-checked leg carries an `other` caveat note that the depth is
  EMODnet modeled bathymetry referenced to LAT, awareness-grade and not charted,
  to be verified on the chart, so the absence of a shallow flag is never read as
  charted clearance.
- No land, no hazards. Reports `coverage.depth` per leg.

### EMODnet client (`src/route-draft/emodnet/emodnet-client.ts`)

GET-only, built on `http-one-shot.ts` (low-volume, one request per EU leg, honors
the caller `AbortSignal`, degrades on failure, no auth or key needed). Base host
`rest.emodnet-bathymetry.eu`, HTTPS, carrying `PLUGIN_USER_AGENT`. WKT axis order
is longitude then latitude, so the internal `{ latitude, longitude }` Position is
serialized as `"lon lat"`; a swap silently queries the wrong place, so a unit
test pins the serialization. The client owns response handling because
`http-one-shot.ts` does not reject non-2xx: HTTP 200 with a usable array parses;
HTTP 204, an empty body, or an all-null array degrades to "not checked"; a real
4xx or 5xx rejects so the leg degrades rather than passes.

### Coastline query and Overpass client surface (`src/inputs/openseamap/`)

The coastline query needs `out geom` polylines, which the current Overpass client
cannot return (its `listPointsOfInterest` resolves one center point per element
via `out center` and discards geometry, and it takes no caller signal). This
requires real new client surface, not a free sibling of `depth-area-query.ts`:

- Add a low-level generic Overpass request method to `OverpassClient` that owns
  the shared endpoint failover, `User-Agent`, rate-limit queue, and a threaded
  caller `AbortSignal`, on which both `listPointsOfInterest` and a new
  `listCoastlineWays` are built. Threading the signal is required, because today
  the client overwrites `init.signal` and honors only plugin-stop, so the
  deadline cannot currently cancel an in-flight Overpass request.
- `listCoastlineWays(bbox, signal)` issues `way["natural"="coastline"](bbox); out geom;`
  and parses way vertex arrays into polylines. Consumed as an internal
  capability, not published as POIs. It lives under `inputs/openseamap` because
  it reuses the Overpass input client, mirroring how `depth-area-query.ts` sits
  under `inputs/noaa-enc`.
- The route-draft hazard query omits the `leisure=marina` overfetch the display
  list query carries, since the corridor scan drops non-hazards anyway.

The Overpass client clamps every bbox edge to a 2 degree span around its center
(`MAX_BBOX_SPAN_DEGREES`). The route-draft per-route hazard sweep and any leg or
route bbox wider than 2 degrees would be silently truncated to the center, hiding
an unscanned gap, which violates the no-silent-pass rule. The route-draft OSM
queries therefore tile any bbox wider than the clamp into sub-boxes of at most 2
degrees and union the results, so coverage is complete; a tile that still cannot
be served degrades to an explicit "not checked", never a silent truncation.

### Shared leg geometry (`src/route-draft/leg-geometry.ts`)

The planar helpers currently private to `safety-check.ts` move here, with the
ENC ring helpers kept behavior-identical so the existing tests stay green, plus
new open-polyline variants for the coastline check:

- Ring helpers (closed, wrap last vertex to first): `pointInRings`,
  `segmentCrossesRings`, the ENC `nearestLandApproachMeters`.
- Polyline helpers (open, no wrap edge): a coastline segment-cross test and a
  point-to-segment nearest-approach for the OSM standoff.
- Shared primitives: `orient2D`, `segmentsCross`, `legPolyline`,
  `projectPointOntoLeg`.

### Region envelopes (`src/shared/regions.ts`)

A new browser-safe module home for the coverage envelopes the resolver reads: it
re-exports the US ENC envelope test (delegating to `isInUsWaters`, which stays in
`us-waters.ts` as the inputs' outbound-HTTP gate) and adds the EMODnet European
envelope (longitude -36 to +43, latitude 15 to 90). Keeping the route-draft
region concept out of `us-waters.ts` avoids coupling that input gate to this
feature.

### Element-to-summary mapper (`src/inputs/openseamap/`)

`toSummary` is private in `openseamap-source.ts`, so the provider cannot reuse it
without a third copy of the element-to-`PoiSummary` mapping (ENC has its own
too). Extract a pure exported mapper that both the source and the provider call,
reusing the already-exported `elementMarking` and `seamarkRegex`, so the icon,
type, and name logic stays in lockstep.

### Service wiring (`src/route-draft/endpoint.ts`, `src/plugin/plugin.ts`)

The `RouteDraftService`, which holds `enc` today, also builds an Overpass client
and an EMODnet client at start. The route-draft Overpass client is its own
instance, separate from the OpenSeaMap input client, since the check runs
automatically and independently of whether the OpenSeaMap input is enabled. The
two clients share the public Overpass endpoints, so route-draft uses a low
concurrency and the tiled, bounded per-route burst, and its admin-gated,
infrequent use keeps the combined load within Overpass fair-use; this is noted
rather than solved with a shared global queue. The orchestrator is assembled from
the three providers. The old outside-US hard refusal is removed in phase 2.

## Data flow

1. The endpoint parses the request, spends a budget call, and calls the model
   for turning waypoints (unchanged).
2. The resolver computes each leg's active provider set from the intersecting
   envelopes.
3. Per leg, in the bounded-concurrency pool, each active provider runs its depth
   and land checks and reports per-dimension coverage; the orchestrator emits
   explicit "not checked" flags for unowned or no-data dimensions.
4. Per hazard-capable provider, one tiled hazard sweep runs over the legs that
   provider covers; ENC and OSM hazards are merged and deduped by position and
   type; flags carry global leg indices.
5. Flags are ordered (land, shallow, hazard, then other), deduped where
   identical per dimension per region, and returned with the route, fuel, and any
   model note (response shape unchanged).

## Honesty and messaging

The existing rule, state the charted value and never a bare verdict, extends to
every source, with wording that carries provenance, datum, and authority:

- Depth: ENC "charted depth area DRVAL1 X m, MLLW, under the Y m draft-plus-margin";
  EMODnet "EMODnet modeled depth X m, LAT, awareness-grade and not charted, under
  the Y m draft-plus-margin", plus the per-leg modeled-data caveat and the
  partial-gap caveat where applicable; where no provider covers depth, "depth not
  checked here, verify on the chart".
- Land: ENC "crosses charted land"; OSM "crosses the OpenStreetMap coastline,
  verify on the chart (absence of a crossing is not proof of clear water)".
- Hazards: ENC "charted wreck within the leg corridor"; OSM "OpenStreetMap-charted
  rock within the leg corridor".

Absence is never a pass. OSM coverage is patchy and EMODnet is interpolated, so
an uncovered or no-data dimension always emits an explicit "not checked" flag,
the hazard sweep runs for every hazard-capable provider that has legs
independently of whether any depth was checked, and a tile that cannot be served
degrades explicitly.

## Configuration

None. The check runs every applicable provider per leg automatically whenever
route-draft is enabled, matching the precedent that the ENC check runs
automatically and does not require the NOAA ENC POI input to be enabled. EMODnet
depth is surfaced with its awareness-only, LAT-referenced caveat in the flag text
rather than behind a toggle.

## Attribution and licence

EMODnet bathymetry is CC-BY 4.0 and requires attribution: "EMODnet Digital
Bathymetry (DTM 2024), EMODnet Bathymetry Consortium", with the dataset DOI.
EMODnet depth is an internal capability, not a published note carrying
`properties.attribution` like the OSM and ENC POIs, so the attribution surface is
the flag text plus a credit line in the route-draft documentation and the README
attribution section. OpenStreetMap coastline remains ODbL, already credited for
OSM data.

## Error handling and limits

- Each provider's upstream query is bounded by the shared request deadline and
  the abort controller; a timeout cancels every in-flight provider query. This
  requires threading the caller signal through the Overpass client (today it
  honors only plugin-stop); EMODnet on `http-one-shot.ts` already threads it.
- A rejected provider query on a leg degrades that dimension to "not checked" for
  that leg, never a silent pass, matching the per-leg ENC degrade.
- Per-leg query budgets stay bounded: one charted-area call per band per leg
  (ENC), one coastline query per leg and one tiled hazard sweep per route (OSM),
  and one depth profile per leg (EMODnet). The Overpass client's low concurrency
  and minimum request spacing mean a long route can exhaust the deadline on
  Overpass queue latency; legs not reached in time degrade to "not checked"
  rather than overrunning, and the route-draft Overpass client uses a lighter
  spacing than the display client to fit the bounded per-route burst inside the
  deadline.

## Testing

`node:test` with injectable deps per provider, stubbing upstream clients:

- Region resolver: US-only, European, elsewhere, mixed-region, and US-envelope-
  overlapping-foreign-water routes (Miami to Bimini), plus the antimeridian case
  where the non-AM-aware bbox helpers must degrade to "not checked", not query a
  wrong area.
- Union and authority: a US nearshore leg runs both ENC and OSM, hazards dedupe
  by position and type, and ENC depth and land win where they overlap.
- EncProvider parity: existing depth, land, drying, standoff, and hazard tests
  retargeted to the provider, behavior unchanged. The two existing tests that are
  really orchestrator or resolver tests (the outside-US-coverage degrade and the
  deadline-abort) move to a new orchestrator suite rather than the provider.
- OpenSeaMapProvider: hazard corridor mapping, the hard-coded hazard filter
  independent of `seamarkGroups`, open-polyline coastline crossing, point-to-
  segment standoff, and the unconditional OSM depth-not-checked flag.
- EmodnetProvider: the flat-array parse with `max()` of non-null, the negative-
  below-datum sign, a positive sample handled as drying or land, partial-no-data
  and all-null degrades, the LAT caveat, and the lon-lat WKT serialization.
- EMODnet client and Overpass client: request construction (URL, LINESTRING geom,
  `User-Agent`, threaded abort) as units separate from the parse, the 2 degree
  clamp and the tiling that defeats it, and that an unservable tile degrades to
  "not checked".
- Orchestrator: a mixed-region route produces the right per-leg provider set and
  the right "not checked" flags, the hazard sweep runs on an all-OSM route even
  though no depth was checked, identical not-checked flags dedupe per dimension
  per region, and a deadline abort cancels every in-flight provider.

## Build order (one branch, three internal phases, one release)

The phases are developed and merged on this branch and shipped as a single npm
release, so the SignalK release checklist and the registry-lag cycle run once,
not three times.

1. Refactor only, behavior-preserving. Extract the geometry, the provider
   interface, the resolver, and the orchestrator; wrap the existing ENC logic as
   `EncProvider`. Phase 1 RETAINS the legacy whole-route outside-US guard and its
   single refusal flag and `checked: false`, so the existing outside-US test
   stays green and all existing tests pass. No new upstream calls.
2. OpenSeaMapProvider. Add the generic Overpass surface, `listCoastlineWays`, the
   threaded signal, the tiling, the exported element-to-summary mapper, and the
   regions module. Replace the whole-route guard with the per-leg union resolver
   and the not-checked model; retarget the outside-US test to the orchestrator.
   Worldwide hazards and coastline land go live.
3. EmodnetProvider. Add the EMODnet client and the depth-profile provider gated
   by the European envelope. European modeled depth goes live. A short live-
   sample spike confirms the response shape stays as specified before this phase
   is committed.

Each phase keeps typecheck, lint, tests, and build green. The CLAUDE.md
architecture prose and the layout tree, the CHANGELOG, and the README are updated
as part of the release, and the placement rule (coastline query under
`inputs/openseamap` because it reuses the Overpass client, EMODnet client under
`route-draft` because it has no POI-source counterpart) is documented so the
layout does not read as inconsistent.

## Open questions resolved

Verified against the live EMODnet REST service and the repository code on
2026-06-14:

- EMODnet `/depth_profile` returns a flat JSON array of signed numbers or null,
  one per DTM cell, in meters, referenced to LAT, negative below datum. Shallowest
  navigable is `max()` of the non-null values. There are no per-cell min, max,
  avg, or smoothed fields on the profile endpoint (those belong to
  `/depth_sample`, which would cost one request per point).
- EMODnet coverage envelope is longitude -36 to +43, latitude 15 to 90. Out of
  coverage degrades (HTTP 204 on sample, null cells on profile), so the coarse
  envelope only decides whether to query; null handling and the awareness caveat
  carry the rest.
- EMODnet needs no auth or key; `http-one-shot.ts` is the right client path.
- WKT axis order is longitude then latitude.

## Remaining items to confirm during planning

- The exact US ENC envelope test the resolver uses for ENC candidacy (reuse
  `isInUsWaters` as-is, accepting that ENC may run and return empty just inside
  foreign water where OSM then carries the leg).
- Whether to move `http-one-shot.ts` to `src/shared/` now that a non-input
  consumer (the EMODnet client under `route-draft`) imports it, or to leave it
  under `inputs` since route-draft already imports from `inputs`.

## References

- EMODnet Bathymetry REST: https://rest.emodnet-bathymetry.eu/
- EMODnet web service documentation: https://emodnet.ec.europa.eu/en/emodnet-web-service-documentation
- EMODnet bathymetry terms and citation: https://emodnet.ec.europa.eu/en/bathymetry
- EMODnet DTM metadata (datum and coverage): https://sextant.ifremer.fr/geonetwork/srv/api/records/18ff0d48-b203-4a65-94a9-5fd8b0ec35f6?language=eng
- Current check: `src/route-draft/safety-check.ts`
- Endpoint: `src/route-draft/endpoint.ts`
- OpenSeaMap seamark mapping: `src/inputs/openseamap/seamark-mapping.ts`
- Overpass client: `src/inputs/openseamap/overpass-client.ts`
