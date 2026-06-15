# Deterministic channel router: design

Status: design, inland-and-enclosed-water-worldwide revision (was US-ENC-only).
Date: 2026-06-15.

## Summary

A deterministic A* router that makes AI route-draft and optimize results follow
navigable water instead of cutting across land. The LLM still resolves intent
(start, destination, place names, constraints), and owned code computes the actual
water-following geometry between the endpoints with A* over a navigable grid built
from the charted polygon data the plugin already fetches. The model proposes where;
owned code disposes how to get there on the water.

The navigable mask is built from POSITIVE water sources and POSITIVE land blockers,
so the router follows mapped water beyond US ENC coverage:

- ENC `Depth_Area` polygons (US, with `DRVAL1`/`DRVAL2` depth), giving both the
  water extent and a depth filter (deep enough = navigable), and ENC `Land_Area`
  polygons (US) as blockers.
- OSM water-area polygons (`natural=water`, `waterway=riverbank`), worldwide, giving
  the water extent with NO depth (depth-unknown, land-avoidance only), and OSM land
  features (`place=island`, `place=islet`, `natural=land`) as blockers so an island
  mapped as its own feature, not as a hole in the water body, still blocks.

This router follows mapped water worldwide: inland and enclosed water everywhere OSM
maps it as a polygon (lakes, rivers drawn as areas, lagoons, and large connected
systems like the Great Lakes), plus US charted areas from ENC. The OPEN SEA, which
OSM does not map as a water polygon (only as the unmapped space outside
`natural=coastline` lines), is out of reach in this version: there the router
declines and the flow falls back to the LLM or drawn route with a note, and the
existing per-leg land and depth checks still run. That is the honest degrade, and it
is also where a straight LLM leg is least likely to cut land. Turning OSM coastline
lines into an open-sea water mask (the coastline-orientation problem) is a named
follow-up, not this version. See "What this version does not cover."

Depth honesty outside ENC stays with the existing per-leg safety check (EMODnet
modeled depth in Europe, the OSM coastline and seamark check worldwide); the router
does not pretend to verify depth where it only has an OSM water outline.

## Problem

The LLM proposes turning waypoints from coordinates alone, and the legs are
straight lines between them. On a winding, island-filled passage (the Detroit
River, Grosse Ile to Belle Isle), it produces sparse waypoints whose straight legs
cut across land and islands, or it places a waypoint inland. A spike confirmed two
things: (1) vision models given a map image cannot reliably trace the channel into
coordinates (both gemini-2.5-flash and gemini-2.5-pro routed over land); (2) a
deterministic A* over a water/land grid traces the channel correctly, mid-channel,
in ~125 ms. So the fix is to route the water path algorithmically, not with the
LLM, while keeping the LLM for what it is good at (knowing where places are and
what the navigator wants). The Detroit River target is inside both ENC coverage and
OSM `natural=water` (the Great Lakes and connecting rivers are mapped as OSM water),
so it is covered twice over; the OSM source extends the same behavior to mapped
inland and enclosed water worldwide.

## Decisions (from brainstorming, plus the worldwide revision)

- **Hybrid.** The LLM resolves endpoints and intent; A* computes the geometry
  between them. Not a separate mode, not a manual snap-only step.
- **Depth-aware, coverage-positive mask, with positive land blockers.** A cell is
  navigable when a positive water source covers it and nothing blocks it:
  - inside an ENC `Depth_Area` charted deep enough (`DRVAL1 >= draft + margin`), OR
  - inside an OSM water polygon (depth-unknown),
  - AND not inside an ENC `Land_Area`, an OSM land feature, an ENC drying/shallow/
    unknown depth area, or a water-polygon hole (island modeled as an inner ring).
  The worldwide OSM water source was deferred in the first draft and is now in this
  version (user decision, 2026-06-15: "Build worldwide into v1 now"), together with
  OSM land blockers, because honest land avoidance outside ENC needs land data, not
  only water data.
- **Both flows.** Applies to draft-from-scratch and to optimize (optimize is
  corridor-constrained around the drawn route).
- **Grid + A*, owned TypeScript, no heavy dependencies.** Rejected: a visibility
  graph / navmesh (much bigger, error-prone) and an npm pathfinding library (a
  dependency for code a few dozen lines covers, against the project rule). The OSM
  query reuses the existing Overpass client, bbox tiling, and HTTP plumbing; it adds
  only a water-and-land area query method and the multipolygon ring assembly.
- **Always on with graceful fallback.** When a water source covers the route and a
  water path exists, the route is replaced with the A* path; otherwise the
  LLM/drawn route is kept unchanged with a "channel routing did not run" note. No
  config toggle (consistent with the "it just works" goal; the OpenRouter key
  already gates the whole AI feature).
- **The existing safety check still runs** on whatever route is returned and stays
  the authority on flags, including depth (which the router never verifies for OSM
  water).
- **OSM water is best-effort.** It is the first thing dropped under deadline
  pressure: ENC-covered routes are unaffected (ENC carries them), and an OSM-only
  route that cannot fetch in time degrades honestly to the LLM route plus a note.

## Architecture and components

A modular slice `src/route-draft/channel-router/`, all owned TypeScript, reusing
existing plumbing, plus one new input-side module for the OSM water-and-land query.
Per the one-plugin, modular-files rule, each file has one responsibility.

- `src/inputs/openseamap/osm-water-query.ts` (new) — the worldwide water-and-land
  source. Tiles the route bbox like `coastline-query.ts`, calls a new
  `listWaterAreas` on the Overpass client per tile, dedupes elements by OSM `type/id`
  across tiles, and assembles each into a polygon `{ rings: number[][][] }` (outer
  ring first, then island holes), the SAME structural ring shape `EncAreaPolygon`
  carries, returning `{ water: Polygon[], land: Polygon[] }`. It does NOT import
  `EncAreaPolygon`; it returns a plain `{ rings }` structural shape so the
  `inputs/openseamap` and `inputs/noaa-enc` slices stay decoupled (neither imports
  the other). A standalone closed way becomes one outer ring; a multipolygon
  relation has its `outer` member ways stitched head-to-tail into closed outer rings
  and its `inner` member ways into hole rings, with an inner ring dropped when it is
  not contained in any assembled outer ring (the unsafe invalid-multipolygon case).
  Threads the deadline signal and a per-query Overpass timeout bound, and enforces
  the element, vertex, and tile caps below.
- `overpass-client.ts` (modify) — add `listWaterAreas(bbox, signal)` returning the
  raw water and land elements as a discriminated, homogeneous-enough type that flows
  through the existing `collectElements(data, parse, skipLabel)` loop with one
  `parseWaterElement(wire)`:
  - The relation wire shape under `out geom;` is `members: Array<{ type, ref, role,
    geometry?: Array<{ lat, lon }> }>`, NOT a top-level `geometry`. Member geometry
    lives in `member.geometry`, and the `outer`/`inner` role in `member.role`. The
    wire type gains an optional `members` field; only `member.type === 'way'` members
    carry usable geometry (node and sub-relation members are dropped), and a member
    with a missing or empty `role` defaults to `outer` per OSM convention.
  - `parseWaterElement` returns a discriminated value:
    `{ kind: 'way', id, role, points: number[][] }` for a way, or
    `{ kind: 'relation', id, role, rings: Array<{ role, points: number[][] }> }` for
    a relation, with `role` carrying `water` or `land` derived from the matched tags
    so the assembler routes each element to `water` or `land`. It returns `null` for
    anything yielding no usable geometry, so the failover, signal, and skip-count
    plumbing in the client is untouched.
  - The query is `out geom;` with NO `tags` and NO `meta` (geometry and member roles
    only), and sets the server-side `[timeout:8]` so a public Overpass server gives
    up early rather than computing a 60 s query the Pi has already abandoned.
- `nav-grid.ts` — builds the navigable grid over a bbox at a chosen cell size from
  the ENC `ChartedAreas` AND the OSM `{ water, land }` polygons, and owns: the
  lon/lat <-> cell transform (planar over the small bbox, the existing geo
  convention), the per-cell classification (below), and the distance-to-shore field
  via a multi-source BFS from blocked cells (for the mid-channel standoff cost).
  Accepts polygons as a structural `{ rings: number[][][] }` from both sources.
  Exposes `buildNavGrid(inputs): NavGrid` and the transform helpers. Pure given its
  inputs. The deadline is threaded into every synchronous pass (the OSM rasterize
  exactly like the ENC rasterize, the BFS, and the corridor pass), bailing to an
  empty (`hasWater = false`) grid on overrun.
- `astar.ts` — pure A* over a `NavGrid`: 8-connectivity, an owned binary-heap
  priority queue, a closed set, step cost `distance * (1 + standoffPenalty(cell))`,
  Euclidean heuristic, and a deadline bail. Returns the ordered cell path or
  `undefined` when start and goal are not connected by navigable cells. No I/O.
- `path-simplify.ts` — Ramer-Douglas-Peucker reduction of the cell path to turning
  waypoints, with a pixel/cell epsilon, then mapped back to lat/lon by the grid
  transform. Pure.
- `channel-router.ts` — the orchestrator. Given the route endpoints, the vessel
  draft and margin, the standoff, and an optional corridor polyline, it: validates
  and computes the route bbox (declining a cross-antimeridian or oversized
  waypoint-derived bbox BEFORE any fetch or tiling), fetches the ENC charted areas
  (per band) AND the OSM water-and-land areas over that bbox CONCURRENTLY via
  `Promise.allSettled` (threading the request deadline signal, proceeding if any
  source returned), builds the grid, snaps the start and goal to the nearest
  navigable cell, runs A*, simplifies, re-validates the final legs at polygon
  resolution, and returns a typed result (waypoints or a decline reason). Reuses
  `leg-geometry` (`pointInRings`, `segmentCrossesRings`, `routeBbox`), the geo
  helpers (`distanceMeters`), and the length constants.

The router's water-polygon land avoidance and the safety check's coastline
land/standoff check use DIFFERENT OSM layers (`natural=water`/land features vs
`natural=coastline` lines) and run at different stages (router before `checkLegs`),
so they may both speak: the safety check can still raise a coastline standoff note on
a router-blessed leg because polygon edges and coastline lines are independently
digitized. That is intended belt-and-suspenders, never silenced by the router; the
check is the independent second pass.

The grid is built by rasterizing the polygons (owned scanline fill) rather than a
point-in-polygon test per cell, so a dense coastline does not make grid
construction quadratic; `pointInRings` remains available for the endpoint-snap and
the final-leg re-check.

## The OSM water-and-land source (new)

OSM does not map the open ocean as a polygon, but it does map inland and enclosed
water as area features: lakes, rivers drawn as areas, lagoons, and large connected
systems like the Great Lakes. These are the `natural=water` (and the older
`waterway=riverbank`) polygons. They are CLOSED rings (standalone ways) or
MULTIPOLYGON RELATIONS with explicit `outer` and `inner` member roles, so unlike
`natural=coastline` there is no winding/orientation inference to do: the relation
states which rings are land holes. Islands are usually inner-ring holes of the water
body, but are sometimes mapped as separate land features, which is why the query
also fetches OSM land blockers.

Query (per tile, `out geom;`, geometry and member roles only, server `[timeout:8]`),
with a value filter applied at the query so the wire payload stays small:

```
way["natural"="water"]["water"!~"pond|reservoir|basin|wastewater"];
relation["natural"="water"]["water"!~"pond|reservoir|basin|wastewater"];
way["waterway"="riverbank"];
relation["waterway"="riverbank"];
way["place"~"^(island|islet)$"];
relation["place"~"^(island|islet)$"];
way["natural"="land"];
relation["natural"="land"];
```

(`water=river` is a sub-tag of `natural=water`, so it is already covered by the
`natural=water` statements and is not a separate statement. The value filter drops
`water=pond`, `reservoir`, `basin`, and `wastewater`: those are not navigable and
their geometry is dead payload on the Pi. A pond is almost never on the rhumb line
between two real marine endpoints, and where one is, the depth-not-checked note and
the absurd-looking geometry are the backstop.)

Assembly (`osm-water-query.ts`):

1. Tile the route bbox into sub-boxes no larger than the client clamp
   (`MAX_BBOX_SPAN_DEGREES`), the same tiling `queryCoastline` uses, capped at
   `MAX_WATER_TILES = 4`: a regional route-draft window is 1 to 4 tiles, and more
   than that is a passage too large for the 30 s budget, so the router declines
   rather than queueing many paced Overpass requests on the shared client.
2. Dedupe elements by `type/id` across tiles: `out geom;` returns an element's full
   geometry (the documented behavior is full, not bbox-clipped, geometry), so a
   large water body intersecting several tiles is returned several times; keep the
   first complete copy, drop repeats. (If live verification finds Overpass clips
   member geometry at the tile bbox, the relation pass switches to a single
   non-tiled query for the route bbox; the verification step below tests a multi-tile
   lake explicitly so this is a checked assumption, not a guess.)
3. A standalone closed way (water tags) -> one water polygon with a single outer
   ring (drop a way that is not closed or has fewer than four vertices). A standalone
   closed way (land tags) -> one land polygon the same way.
4. A relation -> stitch its `outer` member ways head-to-tail (matching shared
   endpoints, reversing a way when needed) into one or more closed outer rings, and
   its `inner` member ways the same way into hole rings; DROP an inner ring not
   contained in any assembled outer ring (the unsafe invalid-multipolygon case where
   an escaping or overlapping inner would flip an island interior back to water under
   even-odd). The result is one polygon whose `rings` are `[...outerRings,
   ...innerRings]`. Under the even-odd rule the grid rasterizer and `pointInRings`
   use, this ring set is correct for a valid multipolygon (non-overlapping outers,
   holes inside their outer); an over-permissive invalid relation that adds extra
   water is caught by the final-leg re-check, and the only even-odd case that would
   route over land (an escaping inner) is removed by the containment drop.
5. Drop a member way left unclosed after stitching, and log the count. An incomplete
   outer ring is dropped rather than force-closed, because force-closing across the
   bbox edge could fabricate water over land. Internal tile seams do not clip a
   relation (full geometry per touched tile, then dedup), so unclosed-chain drops
   occur only at the route-bbox boundary, where decline-and-fallback is honest.

Assembled polygons are NOT validated for full multipolygon correctness; the
containment drop in step 4 removes the one unsafe invalidity, and the final-leg
re-check at polygon resolution is the safety backstop, so an over-permissive (too
much water) assembly cannot produce a land-crossing output.

Bounds and cost (the main new performance surface, see Performance):

- `MAX_WATER_TILES = 4` (above).
- Per-query timeout: `osm-water-query.ts` composes
  `combineAbortSignals([deadlineSignal, AbortSignal.timeout(ROUTER_OSM_QUERY_TIMEOUT_MS)])`
  exactly as `openseamap-provider.ts` does, with `ROUTER_OSM_QUERY_TIMEOUT_MS = 4000`
  (tighter than the safety check's 6 s, because the check still has to run after the
  router), and sets the server `[timeout:8]`.
- `MAX_WATER_ELEMENTS_PER_TILE = 400`: a tile returning more is truncated and a
  truncation is logged so a `no-coverage`/partial decline stays honest.
- `MAX_VERTICES_PER_POLYGON = 20000`: a ring above that is decimated (keep every
  k-th vertex) before rasterization, since a coarse lake outline is fine at the cell
  size; this also bounds the scanline cost (the rasterizer is O(rows x edges) per
  polygon, so a multi-thousand-edge lake must be capped).
- `MAX_TOTAL_WATER_VERTICES = 200000`: stop assembling and log when exceeded.

Because the Detroit River target is ENC-covered, a slow or failed OSM query there is
non-fatal (ENC carries the path); `Promise.allSettled` over the two sources means
either source alone is enough.

## The navigable mask (per cell)

A cell is classified from both sources in this precedence (matching the safety
check's authority order, charted ENC over modeled/OSM), using two bitmaps, `covered`
and `blocked`, where navigable is derived ONCE after every source has stamped both:

1. Inside an ENC `Land_Area` polygon, or an OSM land feature -> `blocked`.
2. Inside an ENC `Depth_Area` charted drying (`DRVAL1 < 0`), shallower than the
   contour (`DRVAL1 < draft + margin`), or of UNKNOWN depth (`DRVAL1` undefined) ->
   `covered` and `blocked` (sticky OR across overlapping bands: a shallower or
   unknown band blocks and a later deep stamp never clears it). The plugin never
   silently passes unknown depth, matching the enc-provider.
3. Inside an ENC `Depth_Area` charted deep enough (`DRVAL1 >= draft + margin`) ->
   `covered`.
4. Inside an OSM water polygon (and not in one of its island holes) -> `covered`,
   depth UNKNOWN (land-avoidance only; the safety check owns depth here).

OSM sources write `covered` (water) or `blocked` (land) and never clear a bit set by
ENC; the navigable derivation `navigable = covered && !blocked` runs once after all
sources are stamped. So ENC's charted block always wins over OSM water on the same
cell (an ENC-shallow cell stays blocked even if OSM maps water there), OSM land
blocks over OSM water, and OSM water only EXTENDS coverage into cells ENC did not
chart. This makes the merge strictly safe: OSM can add navigable water but can never
un-block an ENC hazard, and any land source (ENC or OSM) blocks regardless of which
source mapped the surrounding water.

Land/water rasterization is at cell resolution and so cannot see a feature thinner
than a cell. That is acceptable only because the router re-validates every FINAL
simplified leg against the polygons at full resolution before returning (see
Endpoints and snapping); any final leg that leaves navigable water forces the router
to decline (fallback), so the router's own output is honest at polygon resolution
for the features it has, independent of the safety check.

The standoff is not a hard mask but a soft cost: the distance-to-shore BFS yields a
per-cell clearance, and A* multiplies step cost by a ramp from `STANDOFF_WEIGHT` at
zero clearance to 0 at the desired offing, so the path prefers mid-channel and
honors the configured `routeDraftStandoffNm` without making a narrow channel
impassable (a strict standoff mask would block a channel narrower than twice the
offing).

## Data flow

- **Draft.** After `parseDraftedRoute`, take the first waypoint as the start and
  the last as the destination, and size the route bbox from the LLM's FULL waypoint
  list (its interior points trace where the channel runs, so the grid covers a
  winding channel that bulges outside the straight start-to-end line), padded by a
  meters half-width (the standoff plus a margin) via `routeBbox`. Run the channel
  router start -> goal over the combined mask. On success, replace `route.waypoints`
  with the A* turning waypoints, keeping the model's `name`, `destination`, `note`,
  and `confidence`; the interior waypoints are discarded for geometry (A* owns the
  path). The standoff intent flows through the standoff cost.
- **Optimize.** After `anchorRouteEndpoints` pins the endpoints to the drawn first
  and last, run the router start -> goal with the mask further restricted to a
  corridor: only cells within a configured distance of the drawn polyline are
  navigable, so the result snaps the navigator's route onto the channel without
  abandoning the path they chose. On success, replace the waypoints as above.

The router runs before `checkLegs`, so the safety check still validates the result
(land, shallow, hazard, and the depth-not-checked note for legs no depth source
covers, which is exactly the OSM-water case). The router does NOT rely on the shared
safety check as its land backstop: it re-validates its own final legs at polygon
resolution and declines if any leaves water. The check is the independent second
pass.

## Endpoints and snapping

The LLM endpoints (or the drawn endpoints, for optimize) may sit on land (the bug
this fixes) or just off the navigable grid. Each endpoint is snapped to the nearest
navigable cell by a bounded expanding-ring search, with the ring radius capped in
CELLS at `ceil(maxSnapMeters / grid.cellMeters)` and the candidate accepted only
when `distanceMeters(p, grid.cellCenter(c, r)) <= maxSnapMeters` (~0.5 nm). An
endpoint is kept as-requested only when it is already navigable; when it had to be
snapped (it was on land or off the grid), the SNAPPED cell center is used as the
route endpoint, so the saved route never begins or ends on land. If an endpoint
cannot be snapped within the cap, the router declines (`unsnappable`).

Before returning, the router re-validates every FINAL simplified leg (the snapped
endpoints and the A* interior, after RDP) at full polygon resolution, two ways that
together cover both sources:

1. Exact: no final leg may cross an ENC `Land_Area` ring OR an OSM land ring
   (`segmentCrossesRings`), which catches a sub-cell land sliver the grid missed.
   Land areas do not tile open water, so this has no false positives.
2. Sampled: every sampled point along each final leg (spacing at most
   `grid.cellMeters / 2`, Nyquist against the rasterization resolution, reusing the
   leg-sampling helper) must satisfy a full-resolution `navigableAt(lon, lat)`
   predicate (inside ENC-deep or OSM-water, not inside ENC land or OSM land or ENC
   shallow, not inside a water-polygon hole). `navigableAt` fast-paths through the
   grid's own `navigable` bitmap for an interior sample and falls to `pointInRings`
   only for a sample within one cell of a boundary, so the re-check stays bounded
   even with several large OSM rings. Sampling (not a segment-vs-water-ring test) is
   used for the water case because a leg legitimately running along the shared
   boundary between two adjacent water polygons would cross a water ring and
   false-positive.

If either check fails on any final leg, the router declines (`land-leg`).

## Fallback and honesty

The router returns a typed reason rather than a bare `undefined`, so the caller can
act on the cause: `no-coverage` (no ENC `Depth_Area` AND no OSM water polygon in the
bbox), `no-path` (endpoints in disconnected basins), `unsnappable` (an endpoint too
far from water), `land-leg` (a final leg leaves navigable water on re-check),
`fetch-failed` (every source fetch threw), or `skipped` (too little request budget
left). On any non-success the caller keeps the LLM/drawn route and attaches one
route-level `other` GEOMETRY note distinct from any depth note, so the navigator
always learns when channel routing did not run rather than mistaking a clean line
for a vetted one:

> Channel routing did not run for this passage (no charted depth or mapped water to
> follow), so this is the AI's direct route. The legs are straight lines between
> waypoints, verify each one against the chart.

(The earlier draft suppressed this note for `no-coverage` to avoid duplicating the
safety check's depth note; that is reversed here. The two notes say different things,
one about geometry and one about depth, and "always on" makes the geometry signal
warranted so a declined route is never indistinguishable from a routed one.)

On SUCCESS via OSM water (the route, or any leg of it, was drawn from an OSM water
outline rather than ENC), the caller attaches one additional route-level `other`
caveat, because a confident-looking auto-routed track through depthless water is
exactly where a navigator over-trusts the line:

> This route was auto-routed to follow mapped water outlines that carry no depth
> data, so it avoids charted land but is not depth-checked. Treat it as a draft and
> verify every leg against the chart, especially in narrow or shoal water.

The existing safety check always runs regardless, so a fallback route still gets its
land, shallow, hazard, and depth-not-checked flags. Honesty about depth specifically:
a route the OSM water source carries (no ENC) is land-avoiding but depth-UNVERIFIED
by the router; this is not hidden. The safety check's capability-keyed pass emits the
"Depth not checked on N legs" route note for exactly those legs (no depth provider
covers them, since the OpenSeaMap provider never declares the `depth` capability), in
European seas EMODnet's modeled-depth note covers them instead, and the OSM-water
success caveat above adds the geometry-was-auto-routed truth on top. If a future
router output lands a leg inside ENC or EMODnet coverage, that provider's own depth
verdict or no-charted-depth note applies instead. The router never emits a depth
verdict for OSM water.

## Performance and budget

The hard constraint: one HTTP request with a 30 s deadline, on a Raspberry Pi 5,
where the LLM call alone can take up to ~20 s and the safety check runs AFTER the
router on the SAME single rate-limited Overpass client (`maxConcurrency 2`,
`minDelayMs 1000`, so request STARTS are spaced 1 s apart across the whole request).

- ENC: one charted-areas fetch over the route bbox per usage band (sub-second per
  band in live timing).
- OSM water-and-land: one tiled query over the route bbox, capped at
  `MAX_WATER_TILES = 4`, per-query bounded at `ROUTER_OSM_QUERY_TIMEOUT_MS = 4000`
  with server `[timeout:8]`, the request deadline signal folded in, and the element,
  vertex, and tile caps above. ENC and OSM run CONCURRENTLY via `Promise.allSettled`,
  so wall-clock is the slower of the two, and either source alone (or a partial set
  of ENC bands) is enough to build the grid; only an all-sources failure is
  `fetch-failed`.
- Grid cell size scales to the bbox to keep the cell count under a cap (coarsen
  large bboxes) with a floor that still resolves a narrow channel; A* over that grid
  is ~100-150 ms (spike-measured), with a closed set and a deadline bail. The
  deadline is threaded into the OSM rasterize (capped rings keep it bounded), the
  BFS, the corridor pass, and A*, each bailing to a decline on overrun.
- Budget skip: the router runs only when at least `ROUTER_MIN_BUDGET_MS = 12000`
  remains (a ~4 s OSM cap overlapped with ENC, ~1 s grid and A*, and a ~6 s reserve
  the safety check needs to do anything useful); below that it is SKIPPED (`skipped`
  reason, with the geometry note) and the LLM route plus the safety check run.
- OSM water is best-effort and the first casualty under deadline pressure. This is
  honest and safe: the open sea, where OSM has no water polygon anyway, is also where
  a straight LLM leg least often cuts land, and ENC-covered routes (the Detroit
  River target) are unaffected because ENC carries them. Live verification must
  confirm the combined ENC + OSM fetch over the Grosse Ile to Belle Isle window
  finishes inside the budget, and must also exercise an OSM-water-only target outside
  ENC (an inland lake or wide river with a mapped island), not only the
  doubly-covered Detroit River.
- Total-request-count note: the router's water tiles and the safety check's per-leg
  coastline queries share one rate-limited client, so the total Overpass request
  count, not just the router's, sets wall-clock. The `MAX_WATER_TILES = 4` cap and
  the budget skip bound the router's contribution. Sharing the router's single
  route-bbox nav data with the safety check (so the check tests legs locally instead
  of re-fetching, which also delivers the long-deferred check batching) is the
  highest-value follow-up but is out of scope for this version to keep the router
  landable on its own; the router and check query different Overpass kinds (water and
  land vs coastline vs seamarks), so no response is shared between them today.

## Integration points

- `src/route-draft/endpoint.ts` — call the channel router in `handleDraft` after
  `parseDraftedRoute` (draft) and after `anchorRouteEndpoints` (optimize), before
  `checkLegs`; replace `route.waypoints` on success and attach the OSM-water-success
  caveat when the path used OSM water, else attach the geometry fallback note. A
  budget-floor check (`ROUTER_MIN_BUDGET_MS`) skips it when too little time remains.
  The router needs the ENC client, the Overpass client (already on the service), the
  configured draft and margin, the standoff, the usage bands, and (optimize only) the
  drawn polyline.
- `src/route-draft/config.ts` — add a corridor-half-width default and the
  standoff-cost weight only if they need to be tunable; otherwise keep them as
  module constants. Default to module constants (YAGNI) unless a reviewer argues for
  config.

## Edge cases

- Endpoints in the same cell or a trivial in-water hop: return the two endpoints
  unchanged.
- A drawn optimize route whose corridor excludes all water (drawn entirely over
  land): fallback to the drawn route with the note.
- An antimeridian-crossing or oversized waypoint-derived bbox: the orchestrator
  validates and declines at bbox computation, BEFORE any fetch or tiling, so a stray
  hallucinated far waypoint cannot fan out into many tiles; the grid also declines a
  degenerate bbox as a backstop.
- A very large bbox (a long passage): coarsen the grid to the cell cap; if fitting
  under the cap forces the cell above the size floor, the route is too large and the
  grid declines (no path) and falls back, which is honest.
- Open-sea route with no water polygon and no ENC: `no-coverage` decline, LLM route
  kept with the geometry note; the safety check still flags an OSM coastline crossing
  and the depth-not-checked note. This is the known limitation the coastline-sea
  follow-up addresses.

## What this version does not cover

Stated bluntly so reach is never mistaken for coverage:

- The open sea. OSM does not map open ocean as a water polygon, so an offshore or
  open-coastal leg gets no channel routing: the router declines and the AI's direct
  route is kept, with the existing per-leg land and depth checks still running.
- Depth, for any leg the router draws from OSM water. The water outline carries no
  depth, so an OSM-water route avoids charted land but is not depth-verified. The
  success caveat and the safety check's depth-not-checked note say so.
- A very large water body (a Great-Lakes-scale lake or inland sea). Its OSM
  `natural=water` relation is returned in full by `out geom;` and exceeds the
  router's per-query fetch budget, so the OSM water query times out for it. In US
  waters ENC carries the route there (the Detroit River target is ENC-covered, so
  this is non-fatal); elsewhere the route declines to the model geometry with the
  note. Clipping the relation geometry to the bbox, or fetching only ways, is a
  follow-up.
- An island mapped only as an untagged landform (for example a wooded islet with no
  `place=island`/`islet`, `natural=land`, or water-relation `inner` ring) outside
  ENC coverage. The mask blocks islands that are inner-ring holes or that carry an
  island/land tag, and the final-leg re-check uses the same land data, so an
  entirely untagged inland island is the residual gap. The safety check's OSM
  coastline crossing test may catch a sea island, but an untagged inland island is
  not flagged; verify narrow inland passages against the chart.

## Testing

- `osm-water-query`: a closed water way -> one outer-ring water polygon; a closed
  land way -> one land polygon; an open way dropped; a relation with one outer (split
  across two member ways) and one inner -> a polygon with the outer stitched closed
  and the inner as a hole; an inner ring not contained in the outer is dropped;
  id-dedupe across tiles; an unclosed relation chain dropped; the element, vertex,
  and tile caps enforced (a too-dense ring decimated, a too-many-elements tile
  truncated and logged).
- `nav-grid`: cell classification across the cases (ENC land, ENC deep, ENC shallow,
  ENC unknown-depth, ENC drying, OSM water navigable, OSM water under ENC land
  blocked, OSM water under OSM land blocked, water-polygon hole blocked) on synthetic
  polygons; the distance-to-shore BFS on a synthetic channel; the lon/lat <-> cell
  transform round-trip; the degenerate-bbox and too-coarse declines.
- `astar`: a straight open-water path, a path that must round an island, a no-path
  case (disconnected basins) returning `undefined`, the diagonal-corner-cut guard,
  and the mid-channel preference (a path through a wide channel hugs the center).
- `path-simplify`: RDP collapses a dense centerline to turning points and keeps the
  endpoints.
- `channel-router`: with stubbed `queryChartedAreas` and `queryWaterAreas` (no live
  HTTP): an ENC land-crossing endpoint pair yields a water-only path; an OSM-water-
  only path (no ENC depth areas, water from OSM) yields a water path; an OSM land
  island over OSM water still blocks and the path rounds it; an ENC land area over
  OSM water still blocks; a bbox with neither source returns `no-coverage`; an
  unsnappable inland endpoint returns `unsnappable`; the optimize corridor restricts
  the path to near the drawn polyline; the final-leg re-check returns `land-leg` for
  a route forced to leave water or cross an OSM land ring; an antimeridian-derived
  bbox declines before any fetch.
- `endpoint`: the reason -> note mapping (the geometry note on every non-success,
  including `no-coverage`), the OSM-water-success caveat, the note-merge ordering (a
  `land` check flag precedes an appended `other`), the budget-skip path, and that
  draft passes no corridor while optimize does.

## Out of scope (future)

- An OSM coastline-derived OPEN-SEA water mask (assemble `natural=coastline` lines
  into land polygons with correct winding and bbox closing, so the sea becomes
  navigable-by-default). This is the main extension beyond this version's
  coverage-positive reach; it is deferred because the coastline-orientation/closing
  assembly is error-prone and a wrong result routes over land, the exact bug being
  fixed.
- EMODnet as a grid source: `depthProfile(from, to)` returns a 1-D depth profile
  along a line, not a 2-D grid, so it cannot feed the mask; it stays a post-route
  per-leg depth check.
- Caching the OSM water-and-land fetch (and the coastline/hazard fetches) across
  requests. The project treats caching as a first-class goal, and this is the
  largest uncached path in the feature; it is recorded here as a deliberate
  follow-up rather than an omission. The existing OSM checks are also uncached today,
  so this version is consistent with them.
- Sharing the router's route-bbox nav data with the safety check (batches the check,
  removes its per-leg fetches). High value, separate change.
- Ingesting OSM land into the mask more completely (untagged landforms), and using
  the LLM's interior waypoints as ordered A* via-points to preserve a stated channel
  preference ("via the west passage").
- A visibility-graph / navmesh router for exact geometry.
- Tide- and current-aware or time-of-passage routing.

## NPM ecosystem confirmation

Entirely Node/TypeScript, no Python and no native or heavy dependencies. New
algorithmic code (grid build, scanline rasterize, distance BFS, A*, RDP, OSM
multipolygon ring assembly) is a few hundred lines of owned TypeScript; the OSM
fetch reuses the existing Overpass client, bbox tiling, and HTTP plumbing. Everything
else reuses the plugin's existing data-fetch and geometry primitives. No new runtime
dependency is required.
