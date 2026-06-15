# Deterministic channel router: design

Status: design, awaiting implementation plan.
Date: 2026-06-15.

## Summary

A deterministic A* router that makes AI route-draft and optimize results follow
navigable water instead of cutting across land. The LLM still resolves intent
(start, destination, place names, constraints), and owned code computes the actual
water-following geometry between the endpoints with A* over a navigable grid built
from the charted polygon data the plugin already fetches (ENC `Depth_Area` and
`Land_Area`). The model proposes where; owned code disposes how to get there on
the water. v1 routes where ENC charted coverage exists (US waters, including the
Great Lakes and the Detroit River, the target use) and falls back to the LLM route
elsewhere.

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
what the navigator wants).

## Decisions (from brainstorming)

- **Hybrid.** The LLM resolves endpoints and intent; A* computes the geometry
  between them. Not a separate mode, not a manual snap-only step.
- **Depth-aware mask, ENC-only in v1.** A cell is navigable when it is inside an
  ENC `Depth_Area` charted deep enough (`DRVAL1 >= draft + safety margin`) and not
  in a `Land_Area` or a drying area. The ENC `Depth_Area` polygons double as the
  deep-water source. A worldwide OSM water mask is deferred (see the mask section).
- **Both flows.** Applies to draft-from-scratch and to optimize (optimize is
  corridor-constrained around the drawn route).
- **Grid + A*, owned TypeScript, no heavy dependencies.** Rejected: a visibility
  graph / navmesh (much bigger, error-prone) and an npm pathfinding library (a
  dependency for code a few dozen lines covers, against the project rule).
- **Always on with graceful fallback.** When navigable data covers the route and a
  water path exists, the route is replaced with the A* path; otherwise the
  LLM/drawn route is kept unchanged with a "channel routing unavailable" note. No
  config toggle (consistent with the "it just works" goal; the OpenRouter key
  already gates the whole AI feature).
- **The existing safety check still runs** on whatever route is returned and stays
  the authority on flags.

## Architecture and components

A new modular slice `src/route-draft/channel-router/`, all owned TypeScript,
reusing existing plumbing. Per the one-plugin, modular-files rule, each file has
one responsibility.

- `nav-grid.ts` — builds the navigable grid over a bbox at a chosen cell size from
  the fetched polygons, and owns: the lon/lat <-> cell transform (planar over the
  small bbox, the existing geo convention), the per-cell classification (below),
  and the distance-to-shore field via a multi-source BFS from blocked cells (for
  the mid-channel standoff cost). Exposes `buildNavGrid(inputs): NavGrid` and the
  transform helpers. Pure given its inputs.
- `astar.ts` — pure A* over a `NavGrid`: 8-connectivity, an owned binary-heap
  priority queue, step cost `distance * (1 + standoffPenalty(cell))`, Euclidean
  heuristic. Returns the ordered cell path or `undefined` when start and goal are
  not connected by navigable cells. No I/O.
- `path-simplify.ts` — Ramer-Douglas-Peucker reduction of the cell path to turning
  waypoints, with a pixel/cell epsilon, then mapped back to lat/lon by the grid
  transform. Pure.
- `channel-router.ts` — the orchestrator. Given the route endpoints, the vessel
  draft and margin, the standoff, and an optional corridor polyline, it: computes
  the route bbox (padded), fetches the ENC charted areas over that bbox once per
  band (reusing `queryChartedAreas`, threading the request deadline signal), builds
  the grid, snaps the start and goal to the nearest navigable cell, runs A*,
  simplifies, and returns `Position[]` turning waypoints or `undefined` (fallback).
  Reuses `leg-geometry` (`pointInRings`, `segmentCrossesRings`, `routeBbox`), the
  geo helpers, and the length constants. ENC is fast (sub-second per band query in
  live timing), so no Overpass-style per-query cap is needed here in v1.

The grid is built by rasterizing the polygons (owned scanline fill) rather than a
point-in-polygon test per cell, so a dense coastline does not make grid
construction quadratic; `pointInRings` remains available for the endpoint-snap and
small checks.

## The navigable mask (per cell)

v1 builds the mask from ENC charted polygons only (authoritative US data that
covers the Great Lakes and the Detroit River, the target use), evaluated per cell
in precedence order matching the safety check's authority order:

1. Inside an ENC `Land_Area` polygon -> blocked.
2. Else inside an ENC `Depth_Area` polygon charted as drying (`DRVAL1 < 0`) ->
   blocked (a drying area is treated as land, per the depth decoder's contract).
3. Else inside an ENC `Depth_Area` polygon with a known `DRVAL1 >= draft +
   safetyMargin` (deep enough) -> navigable. A `Depth_Area` whose `DRVAL1` is
   undefined (charted water of unknown depth) is BLOCKED, not navigable: the
   plugin never silently passes unknown depth, matching the enc-provider, which
   excludes undefined-DRVAL1 areas from its deep reading. The `Depth_Area` extent
   is the charted water extent, so a covered-and-deep cell gives both the water
   mask and the depth filter.
4. Else -> blocked (a shallower or unknown-depth area, or no charted water there).

Blocking is sticky across overlapping usage bands (shallowest wins): a cell
covered by both a deep coarse-band area and a shallow or unknown finer-band area is
blocked, because any covering area below the contour or of unknown depth sets the
block and a later deep stamp never clears it.

Land rasterization is at cell resolution and so cannot see a land feature thinner
than a cell. That is acceptable only because the router re-validates every FINAL
simplified leg (including the two snapped-endpoint connecting legs) against the
land polygons at full resolution with `segmentCrossesRings` before returning: any
final leg that crosses land forces the router to decline (fallback), so the
router's own output is honest independent of the safety check.

OSM is deliberately NOT a mask source in v1: the plugin fetches OSM *coastline
lines*, which are sea-only and cannot be turned into a clean inland water/land
mask without solving the coastline-orientation problem, and OSM has no charted
depth. Where a route has no ENC `Depth_Area` coverage, the router declines and the
flow falls back to the LLM/drawn route (see Fallback). A worldwide OSM water-polygon
mask is a named follow-up, not v1.

The standoff is not a hard mask but a soft cost: the distance-to-shore BFS yields a
per-cell clearance, and A* multiplies step cost by `1 + k / (clearance + 1)`, so
the path prefers mid-channel and honors the configured `routeDraftStandoffNm`
without making a narrow channel impassable (a strict standoff mask would block a
channel narrower than twice the offing).

## Data flow

- **Draft.** After `parseDraftedRoute`, take the first waypoint as the start and
  the last as the destination, and size the route bbox from the LLM's FULL waypoint
  list (its interior points trace where the channel runs, so the grid covers a
  winding channel that bulges outside the straight start-to-end line). Run the
  channel router start -> goal over that mask. On success, replace `route.waypoints`
  with the A* turning waypoints, keeping the model's `name`, `destination`, `note`,
  and `confidence`; the interior waypoints are discarded for geometry (A* owns the
  path). Preserving them as A* via-points to keep a stated passage choice ("via the
  west passage") is a noted follow-up. The standoff intent flows through the
  standoff cost.
- **Optimize.** After `anchorRouteEndpoints` pins the endpoints to the drawn first
  and last, run the router start -> goal with the mask further restricted to a
  corridor: only cells within a configured distance of the drawn polyline are
  navigable, so the result snaps the navigator's route onto the channel without
  abandoning the path they chose. On success, replace the waypoints as above.

The router runs before `checkLegs`, so the safety check still validates the result.
But the router does NOT rely on the shared-mask check as its land backstop (the two
read the same polygons, so a coarse-grid land leak could fool both): the router
re-validates its own final legs at polygon resolution (see Endpoints and snapping)
and declines if any cross land. The check is the independent second pass.

## Endpoints and snapping

The LLM endpoints (or the drawn endpoints, for optimize) may sit on land (the bug
this fixes) or just off the navigable grid. Each endpoint is snapped to the nearest
navigable cell by a bounded search, measured in true meters against a cap (~0.5 nm).
An endpoint is kept as-requested only when it is already navigable; when it had to
be snapped (it was on land or off the grid), the SNAPPED cell center is used as the
route endpoint, so the saved route never begins or ends on land. If an endpoint
cannot be snapped within the cap, the router declines.

Before returning, the router re-checks every FINAL simplified leg (the snapped
endpoints and the A* interior, after RDP) against the ENC land polygons at full
resolution with `segmentCrossesRings`. If any final leg crosses land (a sub-cell
sliver the grid missed, or a coarse-grid cell whose footprint was half land), the
router declines. This makes the router's output honest at polygon resolution rather
than trusting the cell grid.

## Fallback and honesty

The router returns a reason rather than a bare `undefined`, so the caller can act on
the cause: `no-coverage` (no ENC `Depth_Area` in the bbox), `no-path` (endpoints in
disconnected basins), `unsnappable` (an endpoint too far from water), `land-leg` (a
final leg crosses land on re-check), `fetch-failed` (the ENC fetch threw), or
`skipped` (too little request budget left). On any reason the caller keeps the
LLM/drawn route. For `no-coverage` the caller does NOT add a channel note, because
the existing safety check already emits its own per-leg no-charted-depth note for
that same condition and a second note would be redundant; for every other reason it
adds one `other` flag naming that the route is the raw draft to verify. The existing
safety check always runs regardless, so a fallback route still gets its land,
shallow, and hazard flags. The absence-of-a-flag honesty contract is unchanged.

## Performance and budget

One ENC charted-areas fetch over the route bbox per usage band (sub-second per
band in live timing), threading the request deadline signal so an abandoned fetch
cancels; it cannot blow the request deadline. Grid cell size scales to the bbox to keep the cell count under
a cap (coarsen large bboxes) with a floor that still resolves a narrow channel; A*
over that grid is ~100-150 ms (spike-measured). The router runs inside the 30 s
request deadline ahead of the bounded safety check; if the remaining budget is too
small, the router is skipped and the LLM route is used (fallback). v1 lets the
safety check keep its own per-leg fetches; sharing the router's single route-bbox
nav data with the check (so the check tests legs locally instead of re-fetching,
which also delivers the long-deferred check batching) is the highest-value
follow-up but is out of scope for v1 to keep the router landable on its own.

## Integration points

- `src/route-draft/endpoint.ts` — call the channel router in `handleDraft` after
  `parseDraftedRoute` (draft) and after `anchorRouteEndpoints` (optimize), before
  `checkLegs`; replace `route.waypoints` on success, else attach the fallback note.
  The router needs the ENC client, the configured draft and margin, the standoff,
  the usage bands, and (optimize only) the drawn polyline.
- `src/route-draft/config.ts` — add a corridor-half-width default and the
  standoff-cost weight to `RouteDraftConfig` (clamped via the shared bounds
  pattern) only if they need to be tunable; otherwise keep them as module
  constants. Decided at plan time; default to module constants (YAGNI) unless a
  reviewer argues for config.

## Edge cases

- Endpoints in the same cell or a trivial in-water hop: return the two endpoints
  unchanged.
- A drawn optimize route whose corridor excludes all water (drawn entirely over
  land): fallback to the drawn route with the note.
- An antimeridian-crossing bbox: the grid transform handles a crossing bbox the
  way the existing bounds helpers do, or the router declines and falls back (decide
  at plan time; declining is acceptable for v1 since the route-draft window is
  regional).
- A very large bbox (a long passage): coarsen the grid to the cell cap; if the
  channel is narrower than the coarsened cell, the router may decline (no path) and
  fall back, which is honest.

## Testing

- `nav-grid`: cell classification across the four precedence cases (land,
  deep-enough depth area, shallow depth area, OSM water) on synthetic polygons;
  the distance-to-shore BFS on a synthetic channel; the lon/lat <-> cell transform
  round-trip.
- `astar`: a straight open-water path, a path that must round an island, and a
  no-path case (disconnected basins) returning `undefined`; the mid-channel
  preference (a path through a wide channel hugs the center, not the bank).
- `path-simplify`: RDP collapses a dense centerline to turning points and keeps
  the endpoints.
- `channel-router`: with a stubbed `queryChartedAreas` (no live HTTP), a known
  land-crossing endpoint pair yields a water-only path; a bbox with no depth areas
  returns `undefined`; an unsnappable inland endpoint returns `undefined`; the
  optimize corridor restricts the path to near the drawn polyline.
- `endpoint` integration: a draft whose LLM route crosses land comes back with the
  A* water route; a no-coverage draft comes back with the LLM route plus the
  fallback note; the safety check still runs in both.

## Out of scope (future)

- A worldwide OSM water-polygon mask (query `natural=water`/`waterway=riverbank`,
  assemble multipolygons) so the router covers navigable water outside ENC
  coverage. The main extension beyond v1's US-ENC reach.
- Sharing the router's route-bbox nav data with the safety check (batches the
  check, removes its per-leg fetches). High value, separate change.
- Using the LLM's interior waypoints as ordered A* via-points to preserve a stated
  channel preference ("via the west passage").
- A visibility-graph / navmesh router for exact geometry.
- Tide- and current-aware or time-of-passage routing.

## NPM ecosystem confirmation

Entirely Node/TypeScript, no Python and no native or heavy dependencies. New
algorithmic code (grid build, scanline rasterize, distance BFS, A*, RDP) is a few
hundred lines of owned TypeScript; everything else reuses the plugin's existing
data-fetch and geometry primitives. No new runtime dependency is required.
