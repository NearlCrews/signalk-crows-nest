# Worldwide route-draft safety check

Date: 2026-06-14
Status: approved design, pending implementation plan

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
route worldwide, the check runs the best providers available for each leg's
region and is explicit about every dimension it could not verify. A route is
never silently passed.

Decided scope (confirmed during brainstorming):

- Worldwide point hazards from OpenSeaMap seamarks.
- Worldwide land crossing from the OpenStreetMap coastline.
- European-seas depth from EMODnet bathymetry, treated as awareness-grade
  modeled data, not authoritative charted depth.
- Provider selection resolved per leg by region.
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
provider model. The current `isInUsWaters` hard gate is replaced by per-leg
region resolution over a small set of providers, each declaring which dimensions
(depth, land, hazards) it supplies and where it applies.

Two alternatives were considered and rejected:

- Inline branches inside the current `checkLegs`. Faster to write, but it grows
  an already large ENC-specific file into a tangle of three providers' logic and
  fails the isolation test.
- A single provider chosen for the whole route. Rejected in favor of per-leg
  resolution so a route straddling regions (US to the Bahamas, European waters
  into open ocean) is checked correctly on each part.

## Architecture

`checkLegs` becomes a thin orchestrator. For each leg it asks a region resolver
which providers apply, runs each provider's per-leg depth and land checks, runs
the hazard scan once per provider-region, and emits an explicit "not checked"
flag for any dimension no provider covered on that leg. The existing
bounded-concurrency leg pool, the request deadline, and abort-on-timeout (which
cancels in-flight upstream queries) are preserved.

### Provider interface

```
interface LegSafetyProvider {
  id: string
  capabilities: { depth: boolean, land: boolean, hazards: boolean }
  coversLeg (from: Position, to: Position): boolean
  // Per-leg depth and land flags for legs this provider covers.
  checkLeg (leg: number, from: Position, to: Position, params): Promise<LegFlag[]>
  // Hazard scan run once over the set of covered legs (providers with hazards).
  checkHazards? (legs: LegRange[], params): Promise<LegFlag[]>
}
```

The orchestrator holds the injected providers, the same dependency-injection
shape the current check uses so tests stub upstream clients without live HTTP.

### Region resolution

Per leg, the resolver returns the provider set for that leg's region:

| Region | Providers on the leg | Depth | Land | Hazards |
| --- | --- | --- | --- | --- |
| US waters | ENC | charted (authoritative) | charted | charted |
| European seas, non-US | OpenSeaMap + EMODnet | EMODnet (modeled, awareness) | OSM coastline | OSM seamarks |
| Elsewhere | OpenSeaMap | not checked | OSM coastline | OSM seamarks |

US legs use ENC alone, so a hazard ENC already charts is never double-flagged by
OSM and no Overpass latency is paid where ENC is authoritative. A leg is treated
as US when both endpoints resolve inside US waters (the existing `isInUsWaters`
gate applied per endpoint), and as European when within the EMODnet coverage
envelope. A dimension covered by no provider on a leg yields an explicit
"not checked" flag, never a silent pass. Actual coverage is still confirmed by
the provider response: a region gate decides whether to query, and an empty or
no-data response degrades to "not checked," mirroring the ENC no-coverage flag.

## Components

### EncProvider (`src/route-draft/providers/enc-provider.ts`)

Today's logic, extracted with behavior preserved: depth-area DRVAL1 contours
(shallowest navigable across bands), drying areas, charted land areas, standoff,
and the wreck, obstruction, and rock corridor scan. The `EncDirectClient`,
`queryChartedAreas`, and the existing band sweep move here.

### OpenSeaMapProvider (`src/route-draft/providers/openseamap-provider.ts`)

- Hazards: reuse `scanRouteCorridor` over OpenSeaMap `rock`, `wreck`, and
  `obstruction` seamarks. The provider queries the Overpass client over the
  covered legs' bbox, maps the elements to `PoiSummary` (the source already does
  this mapping), and runs the same corridor scan as ENC.
- Land: a new `natural=coastline` Overpass query over the leg bbox expanded by
  the standoff. The leg crosses land when any leg sub-segment crosses any
  coastline segment, tested with the existing `segmentsCross` helper. Standoff
  uses nearest-approach from coastline vertices to the leg, the existing
  projection helper. OSM coastline is unclosed ways describing the land and water
  boundary, not closed land polygons, so the flag states a coastline crossing
  ("verify on the chart"), never asserts a point is on land.
- No depth.

### EmodnetProvider (`src/route-draft/providers/emodnet-provider.ts`)

One `/depth_profile?geom=LINESTRING(...)` request per EU leg, built from the
densified leg via `sampleRhumbLeg`. The response carries per-cell depth samples;
the shallowest modeled sample on the leg is compared to draft plus margin. EMODnet
DTM depths are negative below the vertical datum, so the sign and the datum are
handled explicitly (see Open questions). No-data cells degrade to "not checked"
for that leg. No land, no hazards.

### EMODnet client (`src/route-draft/emodnet/emodnet-client.ts`)

GET-only, built on `http-one-shot.ts` like the ENC and USCG clients, carrying
`PLUGIN_USER_AGENT`, honoring the caller `AbortSignal` for the request deadline,
and selecting the `https` transport. Base host `rest.emodnet-bathymetry.eu`.

### Coastline query (`src/inputs/openseamap/coastline-query.ts`)

The `natural=coastline` Overpass query, a sibling to
`src/inputs/noaa-enc/depth-area-query.ts`. Returns coastline ways as polylines
for the OpenSeaMap provider's land check. Consumed as an internal capability,
not published as POIs.

### Shared leg geometry (`src/route-draft/leg-geometry.ts`)

The planar helpers currently private to `safety-check.ts` (`pointInRings`,
`orient2D`, `segmentsCross`, `segmentCrossesRings`, `nearestLandApproachMeters`,
`legPolyline`) move here so the ENC and OpenSeaMap providers share one copy.

### Region envelope (`src/shared/us-waters.ts` or new `src/shared/regions.ts`)

An EMODnet European-seas coverage envelope added beside `isInUsWaters`, used by
the region resolver to decide whether to query EMODnet for a leg.

### Service wiring (`src/route-draft/endpoint.ts`, `src/plugin/plugin.ts`)

The `RouteDraftService`, which holds `enc` today, also builds an Overpass client
and an EMODnet client at start, the same way it builds the ENC client. The
Overpass client reuses the default endpoint list from `shared/overpass-endpoints.ts`.
The clients are built unconditionally, since the feature is fully automatic. The
orchestrator is assembled from the three providers. The old outside-US hard
refusal is removed.

## Data flow

1. The endpoint parses the request, spends a budget call, and calls the model
   for turning waypoints (unchanged).
2. The orchestrator resolves each leg's region and provider set.
3. Per leg, in the bounded-concurrency pool, each applicable provider runs its
   depth and land checks; uncovered dimensions emit a "not checked" flag.
4. Per provider-region, the hazard scan runs once over that region's legs.
5. Flags are ordered (land, shallow, hazard, then other) and returned with the
   route, fuel, and any model note (response shape unchanged).

## Honesty and messaging

The existing rule, state the charted value and never a bare verdict, extends to
every source, with wording that carries provenance and authority:

- Depth: ENC "charted depth area DRVAL1 X m, MLLW, under the Y m draft-plus-margin";
  EMODnet "modeled depth X m (EMODnet bathymetry, awareness only, not charted)
  under the Y m draft-plus-margin"; elsewhere "depth not checked here, verify on
  the chart."
- Land: ENC "crosses charted land"; OSM "crosses the OpenStreetMap coastline,
  verify on the chart."
- Hazards: ENC "charted wreck within the leg corridor"; OSM "OpenStreetMap-charted
  rock within the leg corridor."

Absence is never a pass. OSM coverage is patchy and EMODnet is interpolated, so
an uncovered dimension always emits an explicit "not checked" flag, and a
no-data or empty provider response degrades the same way.

## Configuration

None. The check runs the right providers per region automatically whenever
route-draft is enabled, matching the precedent that the ENC check runs
automatically and does not require the NOAA ENC POI input to be enabled. EMODnet
depth is surfaced with its awareness-only caveat in the flag text rather than
behind a toggle.

## Error handling and limits

- Each provider's upstream query is bounded by the shared request deadline and
  the abort controller; a timeout cancels every in-flight provider query, not
  just ENC.
- A rejected provider query on a leg degrades that dimension to "not checked"
  for that leg, never a silent pass, matching the current per-leg ENC degrade.
- Per-leg query budgets stay bounded: one charted-area call per band per leg
  (ENC), one coastline query per leg (OSM), one depth profile per leg (EMODnet),
  and one hazard scan per provider-region for the route.

## Testing

`node:test` with injectable deps per provider, stubbing upstream clients:

- Region resolver: US, European, elsewhere, mixed-region routes, and the
  antimeridian case.
- EncProvider parity: existing safety-check tests retargeted to the provider,
  behavior unchanged.
- OpenSeaMapProvider: hazard corridor mapping, coastline-crossing geometry, and
  standoff nearest-approach.
- EmodnetProvider: depth-profile parse, negative-depth datum sign handling,
  no-data cells, and the EU envelope gate.
- Orchestrator: a mixed-region route produces the right per-leg providers and
  the right "not checked" flags, and a deadline abort cancels every in-flight
  provider.

## Build order (one spec, three shippable phases)

1. Refactor only: extract the geometry, the provider interface, and the region
   resolver; wrap the existing ENC logic as `EncProvider`; the orchestrator
   reproduces today's behavior; all existing tests green. No new upstream calls.
2. OpenSeaMapProvider: worldwide hazards and coastline land go live.
3. EmodnetProvider: European modeled depth goes live.

Each phase is independently shippable and runs through the project's release
checklist (typecheck, lint, tests, build, then docs and version).

## Open questions to resolve during planning

- EMODnet vertical datum and units of the `/depth_profile` response fields
  (min, max, avg, smoothed), and the exact field to read for the shallowest
  navigable depth. Confirmed against a live sample before the depth comparison
  is wired.
- The EMODnet European-seas coverage envelope bounds (a coarse bbox is enough to
  gate the query; the response confirms actual coverage).
- Whether the EMODnet client warrants the queued/retry `http-client.ts` or the
  simpler one-shot path (leaning one-shot, matching ENC and USCG, since it is
  low-volume and per-leg).

## References

- EMODnet Bathymetry REST: https://rest.emodnet-bathymetry.eu/
- EMODnet web service documentation: https://emodnet.ec.europa.eu/en/emodnet-web-service-documentation
- Current check: `src/route-draft/safety-check.ts`
- Endpoint: `src/route-draft/endpoint.ts`
- OpenSeaMap seamark mapping: `src/inputs/openseamap/seamark-mapping.ts`
