# Vector-tile water source for the channel router: design

Status: design, awaiting review and plan.
Date: 2026-06-15.

## Summary

Replace the channel router's live-Overpass `natural=water` and land fetch with the
pre-clipped `water` layer read from OpenMapTiles-schema vector tiles (the same
OpenFreeMap source Binnacle already renders). This fixes the two worldwide gaps that
30 live test routes exposed in the Overpass-polygon approach: large or long water
bodies timed out because `out geom;` returns full polygon geometry with no bbox clip,
and coastline-bounded water (the open sea, harbors, and fjords) returned nothing
because OSM maps those only with `natural=coastline` lines, not a water polygon. The
vector-tile `water` layer covers ocean, lakes, and rivers as clipped polygons with
islands as holes, worldwide, fetched as small CDN tiles. ENC charted depth stays
primary and authoritative in US waters; tile-water is the worldwide, depth-unknown
coverage layer.

## Problem

The channel router builds a navigable grid from positive water sources. ENC charted
`Depth_Area` polygons cover US waters with depth. Outside ENC, the router fetched OSM
`natural=water` polygons from live Overpass. Live testing over 30 routes found two
hard limits in that OSM path:

- Big-water fetch timeouts. Overpass `out geom;` returns a matched polygon's FULL
  geometry, and Overpass has no bbox clip, so a large lake or a long river returns
  megabytes and exceeds the interactive fetch budget (Lake Geneva ~15 s, Venice ~24
  s, Stockholm ~16 s, the Amazon and the Rhine, Gatun Lake). The route declines.
- Coastline-bounded water. OSM maps the open sea and many harbors, rias, and fjords
  only with `natural=coastline` lines, not a `natural=water` polygon, so the
  coverage-positive mask finds nothing (Sydney Harbour, Oslofjord, Auckland, the
  IJsselmeer). The route declines.

Both trace to one root cause: fetching water as full polygons from live Overpass. A
pre-clipped, pre-resolved water layer removes both at once.

## Decisions (from brainstorming)

- **Vector-tile water replaces the router's Overpass water and land fetch.** The
  tile `water` layer carries ocean, lakes, and rivers as polygons with islands as
  holes, so it supersedes both the OSM `natural=water` query and the OSM
  `place=island`/`natural=land` query in the router. ENC stays primary in US waters.
  The safety check keeps its own OSM coastline and seamark and hazard checks
  unchanged; this design touches only the router's water source.
- **Decode with the standard `@mapbox/vector-tile` plus `pbf` libraries.** A correct
  Mapbox Vector Tile decoder is a few hundred lines of protobuf varint and
  geometry-command parsing that is error-prone to own. These two libraries are the
  de-facto standard (the MapLibre and Mapbox ecosystems build on them), tiny, stable,
  and permissively licensed. This is the case the project's dependency rule allows;
  the comparison is recorded under "Dependency choice."
- **Adaptive zoom, capped tile count.** Pick the highest zoom whose covering-tile
  count stays under a small cap, so precision scales with how zoomed-in the route is.
- **Best-effort with the existing graceful degrade.** A failed tile leaves its area
  uncovered (decline there); all tiles failing is `fetch-failed` and the LLM route is
  kept with a note, the same degrade as today.
- **In-memory LRU cache** of decoded tiles, shared across requests, for the "it just
  works" repeat-draft speed. A persistent on-disk cache is a follow-up.

## Architecture and components

Two new modules, plus a swap in the orchestrator and one change to the re-check. Per
the one-plugin, modular-files rule, each file has one responsibility.

- `src/inputs/vector-tiles/vector-tile-client.ts` (new) — thin HTTP and decode. A
  `createVectorTileClient(tileUrlTemplate, log, options?)` returns
  `{ fetchLayer(z, x, y, layerName, signal?), close() }`. It fetches the tile bytes
  over the shared `http-client` (retry, timeout, abort, `close()`), decodes with
  `new VectorTile(new Protobuf(bytes))`, and returns the named layer's features as
  decoded geometry (tile-local integer coordinates) plus the layer `extent`. Returns
  an empty list when the tile has no such layer. Rejects on HTTP, network, or decode
  failure so the caller can tolerate or fail over. The client owns no tile math and
  no projection; it is the Overpass-client analogue for vector tiles.
- `src/route-draft/channel-router/tile-water-query.ts` (new) — the router's water
  source. `queryTileWater(client, bbox, signal?, logger?): Promise<TileWater>` where
  `TileWater = { water: AreaPolygon[] }` and `AreaPolygon = { rings: number[][][] }`
  (the same structural shape `nav-grid` consumes; this module does not import the ENC
  types). It: selects the zoom (below), enumerates the covering tiles, fetches and
  decodes the `water` layer of each concurrently with per-tile tolerance, transforms
  each feature's tile-local rings to `[lon, lat]` via Web-Mercator tile math, groups
  rings into polygons (outer plus its holes), and returns the water polygons. An
  in-memory LRU keyed by `z/x/y` (bounded, a few hundred entries) caches the decoded
  per-tile water polygons across requests. Rejects only when every covering tile
  failed (so the orchestrator's `Promise.allSettled` reads it as the OSM source did).
- `src/route-draft/channel-router/channel-router.ts` (modify) — the orchestrator's
  injected `queryWaterAreas` (Overpass) becomes `queryTileWater`. The tile-water
  result feeds the grid's `osmWater` input; `osmLand` is empty (islands are holes).
  The `landIncomplete`/`coverage-incomplete` path (an OSM land cap) is removed,
  because tile-water has no separate land cap. The deadline, `fetch-failed`,
  `no-coverage`, snapping, A*, simplify, and fallback flow are otherwise unchanged.
- `src/inputs/openseamap/osm-water-query.ts` and the overpass-client `listWaterAreas`
  added for the prior design become unused by the router and are removed (the safety
  check never used them). The overpass-client keeps `listCoastlineWays` and
  `listPointsOfInterest`, which the safety check still uses.

## Tile selection and coordinate transform

Web-Mercator (the standard XYZ scheme). A tile at zoom `z`, column `X`, row `Y`
spans, in longitude, `360 / 2^z` degrees, and in latitude a Mercator band. The
covering tiles for `bbox` are the integer tile ranges `[Xmin..Xmax] x [Ymin..Ymax]`
from the standard `lon2tile`/`lat2tile` formulas at `z`.

Adaptive zoom: choose the highest `z` in `[MIN_ZOOM, MAX_ZOOM]` whose covering-tile
count `(Xmax - Xmin + 1) * (Ymax - Ymin + 1)` is at most `MAX_TILES`. `MAX_ZOOM = 14`
(about a 2 km tile, detailed near shore), `MAX_TILES = 16`, `MIN_ZOOM = 8`. The
router bbox is already gated to roughly 1.1 degrees by `resolveGridSize`, so a small
harbor bbox lands near z14 and the largest routable bbox near z10; a bbox that cannot
fit `MAX_TILES` even at `MIN_ZOOM` declines (it is larger than the grid would resolve
anyway).

Transform: a feature vertex at tile-local `(px, py)` in `0..extent` (extent is the
layer's, default 4096) at tile `(z, X, Y)` maps to:

```
lon = (X + px / extent) / 2^z * 360 - 180
n   = PI - 2 * PI * (Y + py / extent) / 2^z
lat = atan(sinh(n)) * 180 / PI
```

MVT geometry may carry a small buffer beyond `0..extent`; coordinates slightly
outside map slightly outside the tile, which is harmless because the grid clips to the
bbox.

Ring grouping: the MVT spec winds exterior rings one way and holes the other (by
signed area in tile space). The decoder yields rings per feature; group them into
polygons by signed area (a new exterior starts each `AreaPolygon`, subsequent
opposite-wound rings are its holes). Equivalently, since the grid's fill is even-odd,
all rings of one tile feature may be emitted together as one `AreaPolygon` and the
even-odd rule resolves holes; the signed-area grouping is the explicit, testable form
and is preferred. Each tile's water is clipped to the tile, so adjacent tiles tile the
water continuously; emit per-tile polygons and let the grid rasterize each.

## Mask integration and the safety re-check

The grid is unchanged. Tile-water polygons feed `osmWater` (islands as holes,
resolved by the even-odd scanline fill), `osmLand` is empty, and the ENC bands stay
primary with finest-band-wins. So in US waters ENC owns depth, and tile-water adds
worldwide coverage and fills any ENC gaps.

The final-leg re-check changes. The current re-check is exact land-crossing only
(`segmentCrossesRings` against ENC land and drying rings); it was made exact to avoid
over-declining on uncharted ENC gaps. That exact test is WRONG for tile-water,
because tiles are clipped: a leg legitimately crossing a tile boundary would cross the
clipped water polygon's outer ring and false-positive as a land crossing. So the
re-check becomes, for the tile-water world:

1. Exact, kept: no final leg may cross an ENC `Land_Area` ring or an ENC drying-area
   ring (`segmentCrossesRings`). These are real, non-tiled, no false positives.
2. Sampled, re-introduced: every sampled point along each final leg (spacing at most
   `grid.cellMeters / 2`) must be navigable at full polygon resolution, defined as
   inside an ENC deep-enough `Depth_Area` OR inside a tile-water polygon and not in
   one of its holes, and not inside an ENC land or drying area.

The sampled test is correct here precisely because tile-water is CONTINUOUS: there
are no coverage gaps to over-decline on (the reason it was removed for the ENC-only
case does not apply once tile-water provides a continuous base). It treats a tile
boundary as in-water (a sampled point on the seam is inside the water polygon), and it
catches an island (a hole, where the point is not in water) and a real coast (outside
all water). The router still declines rather than returning a leg that leaves the
water.

## Availability, caching, and ENC

The tile source is online, like the basemap. A failed tile fetch contributes no
water, so its area is uncovered and the router declines there (`no-path` or
`no-coverage`); when every covering tile fails the source rejects and the orchestrator
maps it to `fetch-failed`, keeping the LLM route with the geometry note, the same
degrade as today. The in-memory LRU (bounded, a few hundred decoded tiles, evicting
least-recently-used) makes repeat drafts in the same waters fast and cuts upstream
load; a persistent on-disk cache is a follow-up.

ENC stays primary and authoritative for depth in US waters. Tile-water carries no
depth, so a route drawn from tile-water alone is land-avoiding but depth-unverified:
the existing OSM-water depth caveat applies unchanged (the orchestrator's
`usedOsmWater` becomes `usedTileWater`, same meaning), and the safety check's
depth-not-checked route note still fires where no depth source covers a leg.

## Error handling and edge cases

- A tile with no `water` layer (deep inland with no mapped water, or a fully-land
  tile) decodes to zero water features; that area is uncovered (blocked), which is
  correct.
- A degenerate, antimeridian-crossing, or too-large bbox is already declined before
  any fetch by `resolveGridSize` in the orchestrator; the tile enumeration is only
  reached for a resolvable bbox.
- A decode error on one tile is tolerated (that tile contributes no water and is
  logged); only an all-tiles failure rejects.
- The tile `extent` is read per layer (defaulting to 4096) rather than assumed, so a
  non-default extent transforms correctly.
- Generalization: the tile water boundary is generalized for display at each zoom, so
  it can differ from the true shoreline by up to roughly a cell near shore. This is
  comparable to the 60 m grid resolution and is acceptable; the sampled re-check and
  the standoff cost keep the path off the generalized shore. Very narrow channels
  below the tile generalization at the chosen zoom may be merged or omitted, in which
  case the router declines (honest), as it does today for sub-cell channels.

## Dependency choice

`@mapbox/vector-tile` (with its `@mapbox/point-geometry` peer) and `pbf` are the
canonical MVT decode stack: used across the MapLibre and Mapbox tooling, small (low
tens of kilobytes), zero or minimal transitive dependencies, stable APIs unchanged
for years, and ISC/BSD licensed. Alternatives considered: `vt-pbf` (encode-focused,
wrong direction); `@maplibre/maplibre-gl-style-spec` (far larger, style-focused, not
a tile decoder); a hand-written decoder (rejected: protobuf varint plus the MVT
geometry command and zigzag decoding is error-prone to own and re-verify, exactly the
case the project's "adopt a library when it genuinely beats owning it" rule covers).
The comparison is recorded for the commit and CHANGELOG. These are runtime
dependencies of crows-nest, added to `package.json`.

## Testing

- `vector-tile-client`: decode a small committed fixture `.pbf` (a real tile clipped
  to a tiny area, or a synthetic one built with `vt-pbf` in a test-only dev path),
  extract the `water` layer, assert feature count and that geometry decodes to the
  expected vertex count and extent; an HTTP non-ok status rejects; an already-aborted
  signal rejects; `close()` aborts an in-flight request.
- `tile-water-query`: adaptive-zoom selection across several bbox spans (the chosen
  zoom is the highest with tile count at or under the cap); tile enumeration covers
  the bbox; the tile-local to lon/lat transform round-trips a tile's corners to its
  known geographic bounds; a stubbed client returns water features that assemble to
  polygons with island holes (signed-area grouping); a failed tile is tolerated and
  the rest still return; an all-failed set rejects; an LRU cache hit avoids a second
  client call.
- `channel-router` with a stubbed tile-water source: a coastline-bounded case (ocean
  supplied as a water polygon) now yields a water path; the sampled re-check rejects a
  leg that crosses an island hole and accepts a leg that crosses a tile boundary in
  open water; `usedTileWater` is set when the path used tile-water and not ENC depth.
- `endpoint`: the depth-unverified caveat still attaches on a tile-water success; the
  note merging and budget skip are unchanged.
- Live verification: re-run the worldwide routes that declined (Sydney, Oslofjord,
  Lake Geneva, the Amazon, the Rhine, Gatun Lake, the IJsselmeer) plus a US
  re-confirm (Detroit, SF Bay), and report how many now route, the fetch times, and
  that no returned leg crosses land.

## Out of scope (future)

- A persistent on-disk tile cache (the in-memory LRU is v1).
- Sharing the tile-water and ENC fetch with the safety check (the long-noted check
  batching); this design leaves the safety check's own fetches untouched.
- Using tile depth or bathymetry tiles for a depth filter outside ENC (the tile water
  layer has no depth; EMODnet and ENC remain the depth sources).
- The S-57 to vector-tile pipeline and any change to Binnacle's client rendering;
  this is a server-side router data source only.

## NPM ecosystem confirmation

Node and TypeScript throughout. Two well-established runtime dependencies
(`@mapbox/vector-tile`, `pbf`) for MVT decode, justified above. Tile math, the
projection transform, ring grouping, the LRU cache, and the re-check change are owned
TypeScript reusing the plugin's existing http-client, grid, and geometry primitives.
