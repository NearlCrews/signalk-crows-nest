/**
 * The channel router orchestrator.
 *
 * Given the route endpoints, the vessel draft and margin, the standoff, and an
 * optional optimize corridor, it computes a water-following route: it validates and
 * sizes the route bbox (declining a cross-antimeridian or oversized window before any
 * fetch), fetches the ENC charted areas (per band) and the OSM water-and-land areas
 * over that bbox concurrently, builds the navigable grid, snaps the endpoints to
 * navigable water, runs A*, simplifies the path, re-validates every final leg at
 * polygon resolution, and returns either the turning waypoints or a typed decline
 * reason. The model proposes the endpoints and intent; this owned code disposes the
 * geometry on the water.
 *
 * Coverage is positive: a cell is navigable only where ENC charts it deep enough or
 * where the vector-tile water layer maps water, and any land source (ENC land, ENC
 * drying, a tile-water island hole) blocks. Outside coverage (a failed tile, or a
 * window too large to tile) the router declines and the caller keeps the LLM or drawn
 * route. The router never verifies depth for tile water; that honesty stays with the
 * post-route safety check, and the caller flags a tile-water success as
 * depth-unverified.
 */

import type { EncDirectClient } from '../../inputs/noaa-enc/enc-direct-client.js'
import type { ChartedAreas } from '../../inputs/noaa-enc/depth-area-query.js'
import type { ScaleBand } from '../../shared/scale-band.js'
import type { Bbox, Logger, Position } from '../../shared/types.js'
import { METERS_PER_NAUTICAL_MILE } from '../../shared/length.js'
import { distanceMeters, sampleRhumbLeg } from '../../geo/position-utilities.js'
import { pointInRings, routeBbox, segmentCrossesRings } from '../leg-geometry.js'
import type { QueryChartedAreas } from '../safety-check.js'
import { buildNavGrid, resolveGridSize, type NavGrid } from './nav-grid.js'
import { findPath } from './astar.js'
import { simplifyPath } from './path-simplify.js'
import type { TileWater } from './tile-water-query.js'

/** The tile-water query, matching {@link TileWaterSource.queryTileWater}; injected so tests stub it. */
export type QueryTileWater = (bbox: Bbox, signal?: AbortSignal, logger?: Logger) => Promise<TileWater>

/** A typed reason the router could not produce a water route. */
export type ChannelDeclineReason =
  | 'no-coverage'
  | 'no-path'
  | 'deadline'
  | 'unsnappable'
  | 'land-leg'
  | 'fetch-failed'

/** The result of {@link routeChannel}: the water route, or the reason it could not build one. */
export type ChannelRouteResult =
  | { ok: true, waypoints: Position[], usedTileWater: boolean }
  | { ok: false, reason: ChannelDeclineReason }

/** Injected collaborators; both queries are injected so a test runs without live HTTP. */
export interface ChannelRouterDeps {
  /** The ENC Direct client, passed through to the charted-areas query. */
  client: EncDirectClient
  /** The charted depth-area and land-area query (US). */
  queryChartedAreas: QueryChartedAreas
  /** The worldwide vector-tile water query. */
  queryWater: QueryTileWater
  /** The usage bands to query for ENC depth, finest first. */
  bands: ScaleBand[]
  /** Optional logger for the degrade paths. */
  logger?: Logger
}

/** Parameters describing the passage to route. */
export interface ChannelRouteRequest {
  from: Position
  to: Position
  draftMeters: number
  safetyMarginMeters: number
  standoffNm: number
  /** Optimize only: restrict the mask to a corridor around this drawn polyline. */
  corridor?: Position[]
  /** Anchors that size the route bbox; the LLM's full waypoint list for a draft. Defaults to the corridor or the endpoints. */
  bboxAnchors?: Position[]
  /** Max distance an endpoint may be snapped to navigable water; defaults below. */
  maxSnapMeters?: number
  /** Deadline signal, threaded into the upstream fetches. */
  signal?: AbortSignal
  /** Wall-clock deadline in epoch ms, threaded into the grid build and A*. */
  deadlineMs?: number
}

/**
 * Default cap an endpoint may be snapped to navigable water. A named place or a near-shore
 * waypoint often sits on land or in ENC-charted shallow water (a `DRVAL1 < contour` depth
 * area, which the grid blocks), with the navigable channel a mile or two away: too small a
 * cap declines the whole route as unsnappable and the caller keeps the model's straight line
 * across land, so this is generous enough to reach the channel from a realistic endpoint.
 */
const DEFAULT_MAX_SNAP_METERS = 2 * METERS_PER_NAUTICAL_MILE
/**
 * Padding around the bbox anchors, in meters, so a channel that bulges off the straight line
 * is covered. At least the snap cap, so the navigable water an endpoint may snap to is inside
 * the grid: a snap cap larger than the padded grid would search cells that do not exist.
 */
const BBOX_PAD_METERS = DEFAULT_MAX_SNAP_METERS
/** Optimize corridor half-width when the caller does not override it. */
const CORRIDOR_HALF_WIDTH_METERS = 1 * METERS_PER_NAUTICAL_MILE
/** RDP epsilon, in cells, before the per-grid metric cap below. */
const SIMPLIFY_EPSILON_CELLS = 1.5
/** RDP deviation cap, in meters, so a coarsened grid does not collapse a real bend. */
const SIMPLIFY_EPSILON_METERS = 50
/** Re-check sampling spacing cap, in meters, so a coarsened grid does not widen the sampling past it. */
const SAMPLE_CAP_METERS = 30

/**
 * Compute a water-following route from `from` to `to`. Returns the turning waypoints
 * on success, or a typed decline reason the caller maps to its fallback note.
 */
export async function routeChannel (
  deps: ChannelRouterDeps,
  req: ChannelRouteRequest
): Promise<ChannelRouteResult> {
  const t0 = Date.now()
  const elapsed = (): number => Date.now() - t0
  const anchors = req.bboxAnchors ?? req.corridor ?? [req.from, req.to]
  const bbox = routeBbox(anchors, BBOX_PAD_METERS)
  // Decline a degenerate, cross-antimeridian, or too-large-to-resolve bbox BEFORE any
  // fetch, so a stray far waypoint cannot waste the ENC and OSM fetches that the grid
  // would then decline. This uses the grid's own size resolution, so the pre-fetch
  // decline matches exactly what buildNavGrid would reject.
  if (resolveGridSize(bbox) === null) return { ok: false, reason: 'no-coverage' }

  // Fetch both sources concurrently. ENC fetch never rejects (it returns undefined when
  // every band failed); the tile-water query rejects only when every tile failed. So the
  // ENC settle is always fulfilled, and the only rejection is tile-water. Both empty or
  // failed is fetch-failed; otherwise an empty-but-present result is honest no coverage.
  const [encSettled, tileSettled] = await Promise.allSettled([
    fetchEncAreas(deps, bbox, req.signal),
    deps.queryWater(bbox, req.signal, deps.logger)
  ])
  const encBands = encSettled.status === 'fulfilled' ? encSettled.value : undefined
  const tile = tileSettled.status === 'fulfilled' ? tileSettled.value : undefined
  if (encBands === undefined && tile === undefined) {
    // fetchEncAreas never rejects by design, so log it defensively if that invariant is ever broken.
    if (encSettled.status === 'rejected') deps.logger?.debug(`channel-router fetch-failed (ENC): ${String(encSettled.reason)}`)
    if (tileSettled.status === 'rejected') deps.logger?.debug(`channel-router fetch-failed (tiles): ${String(tileSettled.reason)}`)
    return { ok: false, reason: 'fetch-failed' }
  }
  const bands = encBands ?? []
  // A flattened view of all bands for the land re-check and the tile-water-used test; the grid
  // itself takes the per-band list so a finer band wins per cell (see buildNavGrid). One pass
  // over the bands builds both lists, rather than two flatMaps each walking every band's areas.
  const enc: ChartedAreas = { depthAreas: [], landAreas: [] }
  for (const band of bands) {
    for (const area of band.depthAreas) enc.depthAreas.push(area)
    for (const area of band.landAreas) enc.landAreas.push(area)
  }
  const water: TileWater = tile ?? { water: [] }
  if (enc.depthAreas.length === 0 && water.water.length === 0) return { ok: false, reason: 'no-coverage' }

  const grid = buildNavGrid({
    bbox,
    chartedBands: bands,
    osmWater: water.water,
    draftMeters: req.draftMeters,
    safetyMarginMeters: req.safetyMarginMeters,
    standoffMeters: req.standoffNm * METERS_PER_NAUTICAL_MILE,
    ...(req.corridor !== undefined ? { corridor: { polyline: req.corridor, halfWidthMeters: CORRIDOR_HALF_WIDTH_METERS } } : {}),
    ...(req.deadlineMs !== undefined ? { deadlineMs: req.deadlineMs } : {})
  })
  deps.logger?.debug(`channel-router diag: bands=${bands.length} encAreas=${enc.depthAreas.length}d/${enc.landAreas.length}L tile=${water.water.length} grid=${grid.cols}x${grid.rows}@${grid.cellMeters}m hasWater=${grid.hasWater} (${elapsed()}ms)`)
  if (!grid.hasWater) return { ok: false, reason: 'no-coverage' }

  const maxSnap = req.maxSnapMeters ?? DEFAULT_MAX_SNAP_METERS
  const snapped = snapEndpoints(grid, req.from, req.to, maxSnap)
  if ('reason' in snapped) {
    deps.logger?.debug(`channel-router diag: decline ${snapped.reason} at snap (${elapsed()}ms)`)
    return { ok: false, reason: snapped.reason }
  }
  const { start, goal, comp: mainWater } = snapped

  const pathStatus = { timedOut: false }
  const cells = findPath(grid, start, goal, req.deadlineMs, pathStatus)
  if (cells === undefined) {
    deps.logger?.debug(`channel-router diag: decline ${pathStatus.timedOut ? 'deadline' : 'no-path'} at A* (${elapsed()}ms)`)
    return { ok: false, reason: pathStatus.timedOut ? 'deadline' : 'no-path' }
  }

  const contour = req.draftMeters + req.safetyMarginMeters
  const sampleSpacing = Math.min(grid.cellMeters / 2, SAMPLE_CAP_METERS)
  const landRings = landRingsOf(enc, water)
  const legSafe = (a: Position, b: Position): boolean =>
    legStaysOnWater(a, b, enc, water, sampleSpacing, landRings)

  // Simplify the A* centerline to turning points, then repair: a simplified leg that
  // would cross land or leave water (an RDP chord cutting a concave shore) is replaced by
  // the A* sub-path it spanned, which is land-safe at cell resolution. So the router
  // rounds an island rather than declining on a simplification artifact.
  const epsilon = Math.min(SIMPLIFY_EPSILON_CELLS, SIMPLIFY_EPSILON_METERS / grid.cellMeters)
  const simplified = simplifyPath(cells, epsilon)
  // A collision-free integer key (col + row * cols) instead of a string, since the A* path can be
  // up to the cell cap; this avoids a string allocation per cell.
  const indexByCell = new Map<number, number>()
  cells.forEach((c, i) => indexByCell.set(c[0] + c[1] * grid.cols, i))
  const keptIdx = simplified.map((c) => indexByCell.get(c[0] + c[1] * grid.cols) ?? 0)
  const routeCells: Array<[number, number]> = [cells[keptIdx[0]]]
  for (let k = 1; k < keptIdx.length; k += 1) {
    if (req.deadlineMs !== undefined && Date.now() > req.deadlineMs) {
      deps.logger?.debug(`channel-router diag: decline land-leg at repair deadline (${elapsed()}ms)`)
      return { ok: false, reason: 'land-leg' }
    }
    const p = keptIdx[k - 1]
    const q = keptIdx[k]
    if (legSafe(grid.cellCenter(cells[p][0], cells[p][1]), grid.cellCenter(cells[q][0], cells[q][1]))) {
      routeCells.push(cells[q])
    } else {
      for (let m = p + 1; m <= q; m += 1) routeCells.push(cells[m])
    }
  }

  // Pin the requested endpoints when they sit on the main channel (the navigator chose them), else the
  // snapped cell center. Checking the main component, not just navigability, matters when the requested
  // point is in a disconnected pocket: pinning to it there would make the first leg jump across the gap
  // to where A* actually started, which the re-check would then reject.
  const onMain = (p: Position): boolean => {
    const [c, r] = grid.cellOf(p)
    return grid.isNavigable(c, r) && mainWater[r * grid.cols + c] === 1
  }
  const startPos = onMain(req.from) ? req.from : grid.cellCenter(routeCells[0][0], routeCells[0][1])
  const lastCell = routeCells[routeCells.length - 1]
  const goalPos = onMain(req.to) ? req.to : grid.cellCenter(lastCell[0], lastCell[1])
  const interior = routeCells.slice(1, -1).map(([c, r]) => grid.cellCenter(c, r))
  const waypoints = [startPos, ...interior, goalPos]

  if (!routeStaysOnWater(waypoints, enc, water, sampleSpacing, req.deadlineMs)) {
    if (deps.logger !== undefined) {
      const overDeadline = req.deadlineMs !== undefined && Date.now() > req.deadlineMs
      const reCheckLandRings = landRingsOf(enc, water)
      let detail = 'no failing leg found'
      for (let i = 0; i + 1 < waypoints.length; i += 1) {
        const a = waypoints[i]
        const b = waypoints[i + 1]
        const xCross = reCheckLandRings.some((rings) => segmentCrossesRings([a.longitude, a.latitude], [b.longitude, b.latitude], rings))
        let sampledOff = false
        for (const s of [a, ...sampleRhumbLeg(a, b, Math.max(1, sampleSpacing)), b]) {
          if (!navigableAt(s.longitude, s.latitude, enc, water)) { sampledOff = true; break }
        }
        if (xCross || sampledOff) { detail = `leg ${i}/${waypoints.length - 1} exactCross=${xCross} sampledOff=${sampledOff}`; break }
      }
      deps.logger.debug(`channel-router diag: decline land-leg at re-check, ${waypoints.length}wp, overDeadline=${overDeadline}, ${detail} (${elapsed()}ms)`)
    }
    return { ok: false, reason: 'land-leg' }
  }
  deps.logger?.debug(`channel-router diag: OK ${waypoints.length}wp (${elapsed()}ms)`)
  return { ok: true, waypoints, usedTileWater: usedTileWater(waypoints, enc, water, contour, sampleSpacing) }
}

/**
 * Fetch the ENC charted areas per band, returning the fulfilled bands FINEST FIRST (the
 * order of `deps.bands`), or undefined when every band rejected. The bands are kept
 * separate, not merged, so the grid can let a finer band win per cell.
 */
async function fetchEncAreas (
  deps: ChannelRouterDeps, bbox: Bbox, signal?: AbortSignal
): Promise<ChartedAreas[] | undefined> {
  const settled = await Promise.allSettled(
    deps.bands.map((band) => deps.queryChartedAreas(deps.client, { band, bbox, signal }))
  )
  const ok = settled.filter((s): s is PromiseFulfilledResult<ChartedAreas> => s.status === 'fulfilled').map((s) => s.value)
  if (ok.length === 0) {
    deps.logger?.debug('channel-router: every ENC band fetch failed')
    return undefined
  }
  return ok
}

/** Orthogonal neighbor offsets, hoisted so the component flood does not rebuild them per cell. */
const ORTHO: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * A mask of the 4-connected navigable cells reachable from `seed`. 4-connectivity is a subset of the
 * A* moves (orthogonal steps never corner-cut), so any masked cell is A*-reachable from the seed.
 */
function componentFrom (grid: NavGrid, seed: [number, number]): Uint8Array {
  const { cols, rows } = grid
  const mask = new Uint8Array(cols * rows)
  const queue = new Int32Array(cols * rows)
  let head = 0
  let tail = 0
  const s = seed[1] * cols + seed[0]
  mask[s] = 1
  queue[tail++] = s
  while (head < tail) {
    const i = queue[head++]
    const r = Math.floor(i / cols)
    const c = i - r * cols
    for (const [dc, dr] of ORTHO) {
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      const ni = nr * cols + nc
      if (mask[ni] === 1 || !grid.isNavigable(nc, nr)) continue
      mask[ni] = 1
      queue[tail++] = ni
    }
  }
  return mask
}

/**
 * A mask of the cells in the LARGEST 4-connected navigable component, the through-channel. Both
 * endpoints prefer to snap onto it, since a near-shore endpoint's nearest water is often a tiny
 * isolated pocket while the main waterway sits a little further out.
 */
function largestNavigableComponent (grid: NavGrid): Uint8Array {
  const { cols, rows } = grid
  const n = cols * rows
  const comp = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let bestId = -1
  let bestSize = 0
  let nextId = 0
  for (let seed = 0; seed < n; seed += 1) {
    if (comp[seed] !== -1) continue
    const sc = seed % cols
    const sr = (seed - sc) / cols
    if (!grid.isNavigable(sc, sr)) continue
    const id = nextId++
    let head = 0
    let tail = 0
    let size = 0
    comp[seed] = id
    queue[tail++] = seed
    while (head < tail) {
      const i = queue[head++]
      size += 1
      const r = Math.floor(i / cols)
      const c = i - r * cols
      for (const [dc, dr] of ORTHO) {
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
        const ni = nr * cols + nc
        if (comp[ni] !== -1 || !grid.isNavigable(nc, nr)) continue
        comp[ni] = id
        queue[tail++] = ni
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id }
  }
  const mask = new Uint8Array(n)
  if (bestId >= 0) for (let i = 0; i < n; i += 1) if (comp[i] === bestId) mask[i] = 1
  return mask
}

/** Either both endpoints snapped onto a shared navigable component (with that component), or a reason. */
type SnapResult =
  | { start: [number, number], goal: [number, number], comp: Uint8Array }
  | { reason: 'unsnappable' | 'no-path' }

/**
 * Snap both endpoints onto a SHARED navigable component so A* can connect them. They first try the
 * largest component (the through-channel), since a near-shore endpoint's nearest water is often a tiny
 * isolated pocket A* cannot escape while the main waterway is a little further out. When both cannot
 * reach the largest, fall back to each endpoint's own nearest water and, if those differ, re-snap one
 * into the other's component. If neither can reach the other's water within the cap, the basins are
 * genuinely disconnected (no-path); if an endpoint has no navigable water within the cap at all, unsnappable.
 */
function snapEndpoints (grid: NavGrid, from: Position, to: Position, maxSnap: number): SnapResult {
  const largest = largestNavigableComponent(grid)
  const startMain = snapToWater(grid, from, maxSnap, largest)
  const goalMain = snapToWater(grid, to, maxSnap, largest)
  if (startMain !== undefined && goalMain !== undefined) return { start: startMain, goal: goalMain, comp: largest }

  const startNear = snapToWater(grid, from, maxSnap)
  const goalNear = snapToWater(grid, to, maxSnap)
  if (startNear === undefined || goalNear === undefined) return { reason: 'unsnappable' }
  const goalComp = componentFrom(grid, goalNear)
  if (goalComp[startNear[1] * grid.cols + startNear[0]] === 1) return { start: startNear, goal: goalNear, comp: goalComp }
  const startInGoal = snapToWater(grid, from, maxSnap, goalComp)
  if (startInGoal !== undefined) return { start: startInGoal, goal: goalNear, comp: goalComp }
  const startComp = componentFrom(grid, startNear)
  const goalInStart = snapToWater(grid, to, maxSnap, startComp)
  if (goalInStart !== undefined) return { start: startNear, goal: goalInStart, comp: startComp }
  return { reason: 'no-path' }
}

/**
 * The nearest navigable cell to a position within `maxSnapMeters`, by an
 * expanding-ring search bounded in cells by the grid's own cell size, accepting a
 * candidate only when its true distance is within the cap and, when `inComponent` is
 * given, the cell is in that component. Returns the position's own cell when it qualifies.
 */
function snapToWater (grid: NavGrid, p: Position, maxSnapMeters: number, inComponent?: Uint8Array): [number, number] | undefined {
  const ok = (c: number, r: number): boolean =>
    grid.isNavigable(c, r) && (inComponent === undefined || inComponent[r * grid.cols + c] === 1)
  const [c0, r0] = grid.cellOf(p)
  if (ok(c0, r0)) return [c0, r0]
  const maxRadius = Math.max(1, Math.ceil(maxSnapMeters / grid.cellMeters))
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue
        const c = c0 + dc
        const r = r0 + dr
        if (ok(c, r) && distanceMeters(p, grid.cellCenter(c, r)) <= maxSnapMeters) return [c, r]
      }
    }
  }
  return undefined
}

/** True when a point is inside an ENC depth area charted deep enough (defined `DRVAL1 >= contour`). */
function inEncDeep (lon: number, lat: number, charted: ChartedAreas, contour: number): boolean {
  return charted.depthAreas.some((area) => {
    if (!pointInRings(lon, lat, area.rings)) return false
    const drval1 = area.depthRange?.shallowMeters
    return drval1 !== undefined && drval1 >= contour
  })
}

/**
 * The land rings a route must not cross, for the EXACT crossing test: ENC `Land_Area`
 * polygons, ENC drying areas (charted `DRVAL1 < 0`, treated as land), and the HOLE
 * rings of tile-water polygons (islands fully within a tile). Tile-water OUTER rings
 * are deliberately NOT included: they include the tile-clip seam, so an exact test
 * against them would false-positive on a leg crossing a tile boundary; the coast and
 * seam islands are caught by the sampled navigability test instead. Built once per
 * route so a caller checking many legs does not rebuild it.
 */
function landRingsOf (charted: ChartedAreas, water: TileWater): number[][][][] {
  const drying = charted.depthAreas
    .filter((a) => { const d = a.depthRange?.shallowMeters; return d !== undefined && d < 0 })
    .map((a) => a.rings)
  const islandHoles = water.water.filter((p) => p.rings.length > 1).map((p) => p.rings.slice(1))
  return [...charted.landAreas.map((a) => a.rings), ...drying, ...islandHoles]
}

/**
 * Whether a point is ON NAVIGABLE WATER for the re-check. The re-check verifies the route stays on
 * water and does not cross land or leave the water; it does NOT require the water to be deep enough,
 * because depth is the safety check's job (it flags every charted-shallow leg with its DRVAL1 and
 * datum). Routing through charted-shallow water and reporting it as a draft to verify is far better
 * than declining and keeping the model's straight line across land. So a point is off water only
 * inside ENC land, inside an ENC drying area (charted `DRVAL1 < 0`, exposed at low tide), or outside
 * all water (a coast or an uncharted gap); a point in any other ENC depth area or in tile water is on
 * water. A tile-water route still earns the depth-unverified caveat via {@link usedTileWater}.
 */
function navigableAt (lon: number, lat: number, charted: ChartedAreas, water: TileWater): boolean {
  if (charted.landAreas.some((a) => pointInRings(lon, lat, a.rings))) return false
  let inEncWater = false
  for (const area of charted.depthAreas) {
    if (!pointInRings(lon, lat, area.rings)) continue
    const drval1 = area.depthRange?.shallowMeters
    if (drval1 !== undefined && drval1 < 0) return false // drying: exposed at low tide, treat as land
    inEncWater = true
  }
  if (inEncWater) return true
  return water.water.some((w) => pointInRings(lon, lat, w.rings))
}

/**
 * True when a single final leg stays on navigable water: it crosses no exact land ring
 * (ENC land, ENC drying, a tile-water island hole), and every sampled point along it is
 * navigable at full resolution. The exact test catches a thin island the sampling could
 * straddle; the sampled test catches a real coast or a tile-seam island (where the
 * point is outside all water) and treats a tile boundary as in-water.
 */
function legStaysOnWater (
  a: Position, b: Position, charted: ChartedAreas, water: TileWater,
  sampleSpacingMeters: number, landRings: number[][][][]
): boolean {
  const aPt = [a.longitude, a.latitude]
  const bPt = [b.longitude, b.latitude]
  if (landRings.some((rings) => segmentCrossesRings(aPt, bPt, rings))) return false
  if (!navigableAt(a.longitude, a.latitude, charted, water)) return false
  for (const s of sampleRhumbLeg(a, b, Math.max(1, sampleSpacingMeters))) {
    if (!navigableAt(s.longitude, s.latitude, charted, water)) return false
  }
  return navigableAt(b.longitude, b.latitude, charted, water)
}

/**
 * True when no final leg leaves navigable water. The router's honesty backstop at full
 * polygon resolution, independent of the cell grid. Exported so the re-check is
 * unit-tested directly.
 */
export function routeStaysOnWater (
  waypoints: Position[],
  charted: ChartedAreas,
  water: TileWater,
  sampleSpacingMeters: number,
  deadlineMs?: number
): boolean {
  const landRings = landRingsOf(charted, water)
  for (let i = 0; i + 1 < waypoints.length; i += 1) {
    // Bail to a decline if the synchronous re-check runs past the deadline, rather than
    // overrunning into the safety check's budget. A declined route is the safe outcome.
    if (deadlineMs !== undefined && Date.now() > deadlineMs) return false
    if (!legStaysOnWater(waypoints[i], waypoints[i + 1], charted, water, sampleSpacingMeters, landRings)) {
      return false
    }
  }
  return true
}

/**
 * True when any sampled point along the route sits on tile water rather than inside an
 * ENC deep-enough area, so a route whose waypoints land in ENC depth but whose legs
 * pass through tile-water-only stretches still earns the depth-unverified caveat. Uses
 * the SAME `inEncDeep` predicate the re-check uses, so a tile-water leg (including a
 * tile-water fill of an ENC gap) is never presented as depth-checked.
 */
function usedTileWater (
  waypoints: Position[], charted: ChartedAreas, water: TileWater, contour: number, sampleSpacingMeters: number
): boolean {
  if (water.water.length === 0) return false
  const spacing = Math.max(1, sampleSpacingMeters)
  const onTileWater = (p: Position): boolean =>
    !inEncDeep(p.longitude, p.latitude, charted, contour) &&
    water.water.some((w) => pointInRings(p.longitude, p.latitude, w.rings))
  for (let i = 0; i + 1 < waypoints.length; i += 1) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    if (onTileWater(a) || onTileWater(b)) return true
    for (const p of sampleRhumbLeg(a, b, spacing)) if (onTileWater(p)) return true
  }
  return false
}
