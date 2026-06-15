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
 * where OSM maps water, and any land source (ENC land, OSM land) blocks. Outside both
 * (notably the open sea, which OSM does not map as a water polygon) the router
 * declines and the caller keeps the LLM or drawn route. The router never verifies
 * depth for OSM water; that honesty stays with the post-route safety check, and the
 * caller flags an OSM-water success as depth-unverified.
 */

import type { EncDirectClient } from '../../inputs/noaa-enc/enc-direct-client.js'
import type { ChartedAreas } from '../../inputs/noaa-enc/depth-area-query.js'
import type { OverpassClient } from '../../inputs/openseamap/overpass-client.js'
import type { ScaleBand } from '../../shared/scale-band.js'
import type { Bbox, Logger, Position } from '../../shared/types.js'
import { METERS_PER_NAUTICAL_MILE } from '../../shared/length.js'
import { distanceMeters, sampleRhumbLeg } from '../../geo/position-utilities.js'
import { pointInRings, routeBbox, segmentCrossesRings } from '../leg-geometry.js'
import type { QueryChartedAreas } from '../safety-check.js'
import { buildNavGrid, resolveGridSize, type NavGrid } from './nav-grid.js'
import { findPath } from './astar.js'
import { simplifyPath } from './path-simplify.js'
import type { OsmAreas } from './osm-water-query.js'

/** The OSM water-and-land query, matching {@link queryWaterAreas}; injected so tests stub it. */
export type QueryWaterAreas = (
  client: OverpassClient, bbox: Bbox, signal?: AbortSignal, logger?: Logger
) => Promise<OsmAreas>

/** A typed reason the router could not produce a water route. */
export type ChannelDeclineReason =
  | 'no-coverage'
  | 'no-path'
  | 'unsnappable'
  | 'land-leg'
  | 'fetch-failed'
  | 'coverage-incomplete'

/** The result of {@link routeChannel}: the water route, or the reason it could not build one. */
export type ChannelRouteResult =
  | { ok: true, waypoints: Position[], usedOsmWater: boolean }
  | { ok: false, reason: ChannelDeclineReason }

/** Injected collaborators; both queries are injected so a test runs without live HTTP. */
export interface ChannelRouterDeps {
  /** The ENC Direct client, passed through to the charted-areas query. */
  client: EncDirectClient
  /** The charted depth-area and land-area query (US). */
  queryChartedAreas: QueryChartedAreas
  /** The Overpass client, passed through to the water-and-land query. */
  overpass: OverpassClient
  /** The OSM water-and-land query (worldwide). */
  queryWaterAreas: QueryWaterAreas
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

/** Padding around the bbox anchors, in meters, so a channel that bulges off the straight line is covered. */
const BBOX_PAD_METERS = 0.5 * METERS_PER_NAUTICAL_MILE
/** Default cap an endpoint may be snapped to navigable water. */
const DEFAULT_MAX_SNAP_METERS = 0.5 * METERS_PER_NAUTICAL_MILE
/** Optimize corridor half-width when the caller does not override it. */
const CORRIDOR_HALF_WIDTH_METERS = 1 * METERS_PER_NAUTICAL_MILE
/** RDP epsilon, in cells, before the per-grid metric cap below. */
const SIMPLIFY_EPSILON_CELLS = 1.5
/** RDP deviation cap, in meters, so a coarsened grid does not collapse a real bend. */
const SIMPLIFY_EPSILON_METERS = 50

/**
 * Compute a water-following route from `from` to `to`. Returns the turning waypoints
 * on success, or a typed decline reason the caller maps to its fallback note.
 */
export async function routeChannel (
  deps: ChannelRouterDeps,
  req: ChannelRouteRequest
): Promise<ChannelRouteResult> {
  const anchors = req.bboxAnchors ?? req.corridor ?? [req.from, req.to]
  const bbox = routeBbox(anchors, BBOX_PAD_METERS)
  // Decline a degenerate, cross-antimeridian, or too-large-to-resolve bbox BEFORE any
  // fetch, so a stray far waypoint cannot waste the ENC and OSM fetches that the grid
  // would then decline. This uses the grid's own size resolution, so the pre-fetch
  // decline matches exactly what buildNavGrid would reject.
  if (resolveGridSize(bbox) === null) return { ok: false, reason: 'no-coverage' }

  // Fetch both sources concurrently. ENC fetch never rejects (it returns undefined when
  // every band failed); the OSM query rejects only when every tile failed. So the ENC
  // settle is always fulfilled, and the only rejection is OSM. Both empty or failed is
  // fetch-failed; otherwise an empty-but-present result is honest no coverage.
  const [encSettled, osmSettled] = await Promise.allSettled([
    fetchEncAreas(deps, bbox, req.signal),
    deps.queryWaterAreas(deps.overpass, bbox, req.signal, deps.logger)
  ])
  const charted = encSettled.status === 'fulfilled' ? encSettled.value : undefined
  const osm = osmSettled.status === 'fulfilled' ? osmSettled.value : undefined
  if (charted === undefined && osm === undefined) {
    if (osmSettled.status === 'rejected') deps.logger?.debug(`channel-router fetch-failed: ${String(osmSettled.reason)}`)
    return { ok: false, reason: 'fetch-failed' }
  }
  const enc: ChartedAreas = charted ?? { depthAreas: [], landAreas: [] }
  const water: OsmAreas = osm ?? { water: [], land: [] }
  // A capped-out land mask cannot be trusted (a dropped blocker could route over land), so
  // decline rather than route on an incomplete land mask.
  if (water.landIncomplete === true) return { ok: false, reason: 'coverage-incomplete' }
  if (enc.depthAreas.length === 0 && water.water.length === 0) return { ok: false, reason: 'no-coverage' }

  const grid = buildNavGrid({
    bbox,
    charted: enc,
    osmWater: water.water,
    osmLand: water.land,
    draftMeters: req.draftMeters,
    safetyMarginMeters: req.safetyMarginMeters,
    standoffMeters: req.standoffNm * METERS_PER_NAUTICAL_MILE,
    ...(req.corridor !== undefined ? { corridor: { polyline: req.corridor, halfWidthMeters: CORRIDOR_HALF_WIDTH_METERS } } : {}),
    ...(req.deadlineMs !== undefined ? { deadlineMs: req.deadlineMs } : {})
  })
  if (!grid.hasWater) return { ok: false, reason: 'no-coverage' }

  const maxSnap = req.maxSnapMeters ?? DEFAULT_MAX_SNAP_METERS
  const start = snapToWater(grid, req.from, maxSnap)
  const goal = snapToWater(grid, req.to, maxSnap)
  if (start === undefined || goal === undefined) return { ok: false, reason: 'unsnappable' }

  const cells = findPath(grid, start, goal, req.deadlineMs)
  if (cells === undefined) return { ok: false, reason: 'no-path' }

  const contour = req.draftMeters + req.safetyMarginMeters
  const sampleSpacing = grid.cellMeters / 2
  const landRings = landRingsOf(enc, water)
  const legSafe = (a: Position, b: Position): boolean => !legCrossesLand(a, b, landRings)

  // Simplify the A* centerline to turning points, then repair: a simplified leg that
  // would cross land or leave water (an RDP chord cutting a concave shore) is replaced by
  // the A* sub-path it spanned, which is land-safe at cell resolution. So the router
  // rounds an island rather than declining on a simplification artifact.
  const epsilon = Math.min(SIMPLIFY_EPSILON_CELLS, SIMPLIFY_EPSILON_METERS / grid.cellMeters)
  const simplified = simplifyPath(cells, epsilon)
  const indexByCell = new Map<string, number>()
  cells.forEach((c, i) => indexByCell.set(`${c[0]},${c[1]}`, i))
  const keptIdx = simplified.map((c) => indexByCell.get(`${c[0]},${c[1]}`) ?? 0)
  const routeCells: Array<[number, number]> = [cells[keptIdx[0]]]
  for (let k = 1; k < keptIdx.length; k += 1) {
    if (req.deadlineMs !== undefined && Date.now() > req.deadlineMs) return { ok: false, reason: 'land-leg' }
    const p = keptIdx[k - 1]
    const q = keptIdx[k]
    if (legSafe(grid.cellCenter(cells[p][0], cells[p][1]), grid.cellCenter(cells[q][0], cells[q][1]))) {
      routeCells.push(cells[q])
    } else {
      for (let m = p + 1; m <= q; m += 1) routeCells.push(cells[m])
    }
  }

  // Pin the requested endpoints when navigable (the navigator chose them), else the snapped cell center.
  const startPos = grid.isNavigable(...grid.cellOf(req.from)) ? req.from : grid.cellCenter(routeCells[0][0], routeCells[0][1])
  const lastCell = routeCells[routeCells.length - 1]
  const goalPos = grid.isNavigable(...grid.cellOf(req.to)) ? req.to : grid.cellCenter(lastCell[0], lastCell[1])
  const interior = routeCells.slice(1, -1).map(([c, r]) => grid.cellCenter(c, r))
  const waypoints = [startPos, ...interior, goalPos]

  if (!routeStaysOnWater(waypoints, enc, water, req.deadlineMs)) {
    return { ok: false, reason: 'land-leg' }
  }
  return { ok: true, waypoints, usedOsmWater: usedOsmWater(waypoints, enc, water, contour, sampleSpacing) }
}

/** Fetch and merge the ENC charted areas across the bands, or undefined when every band rejected. */
async function fetchEncAreas (
  deps: ChannelRouterDeps, bbox: Bbox, signal?: AbortSignal
): Promise<ChartedAreas | undefined> {
  const settled = await Promise.allSettled(
    deps.bands.map((band) => deps.queryChartedAreas(deps.client, { band, bbox, signal }))
  )
  const ok = settled.filter((s): s is PromiseFulfilledResult<ChartedAreas> => s.status === 'fulfilled').map((s) => s.value)
  if (ok.length === 0) {
    deps.logger?.debug('channel-router: every ENC band fetch failed')
    return undefined
  }
  return {
    depthAreas: ok.flatMap((a) => a.depthAreas),
    landAreas: ok.flatMap((a) => a.landAreas)
  }
}

/**
 * The nearest navigable cell to a position within `maxSnapMeters`, by an
 * expanding-ring search bounded in cells by the grid's own cell size, accepting a
 * candidate only when its true distance is within the cap. Returns the position's own
 * cell when it is already navigable.
 */
function snapToWater (grid: NavGrid, p: Position, maxSnapMeters: number): [number, number] | undefined {
  const [c0, r0] = grid.cellOf(p)
  if (grid.isNavigable(c0, r0)) return [c0, r0]
  const maxRadius = Math.max(1, Math.ceil(maxSnapMeters / grid.cellMeters))
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue
        const c = c0 + dc
        const r = r0 + dr
        if (grid.isNavigable(c, r) && distanceMeters(p, grid.cellCenter(c, r)) <= maxSnapMeters) return [c, r]
      }
    }
  }
  return undefined
}

/**
 * The land rings a route must not cross: ENC `Land_Area` polygons, ENC drying areas
 * (charted `DRVAL1 < 0`, treated as land per the depth decoder's contract), and OSM
 * land features (islands mapped as their own feature, explicit land). Built once per
 * route so a caller checking many legs does not rebuild it.
 */
function landRingsOf (charted: ChartedAreas, osm: OsmAreas): number[][][][] {
  const drying = charted.depthAreas
    .filter((a) => { const d = a.depthRange?.shallowMeters; return d !== undefined && d < 0 })
    .map((a) => a.rings)
  return [...charted.landAreas.map((a) => a.rings), ...drying, ...osm.land.map((a) => a.rings)]
}

/** True when the leg `a`->`b` crosses any land ring (exact, no sampling). */
function legCrossesLand (a: Position, b: Position, landRings: number[][][][]): boolean {
  const aPt = [a.longitude, a.latitude]
  const bPt = [b.longitude, b.latitude]
  return landRings.some((rings) => segmentCrossesRings(aPt, bPt, rings))
}

/**
 * True when no final leg crosses charted land. This is the router's own honesty
 * backstop at full polygon resolution, independent of the cell grid: the grid routes
 * on positively-covered water, and this catches a simplified or snapped leg that would
 * cut land (a sub-cell sliver, or an island the grid missed). It checks LAND only, not
 * coverage or depth: an uncharted gap between depth areas is not land, and a leg
 * through shallow or uncharted water is the safety check's job to flag, never silently
 * a land crossing. Exported so the re-check is unit-tested directly.
 */
export function routeStaysOnWater (
  waypoints: Position[],
  charted: ChartedAreas,
  osm: OsmAreas,
  deadlineMs?: number
): boolean {
  const landRings = landRingsOf(charted, osm)
  for (let i = 0; i + 1 < waypoints.length; i += 1) {
    // Bail to a decline if the synchronous re-check runs past the deadline, rather than
    // overrunning into the safety check's budget. A declined route is the safe outcome.
    if (deadlineMs !== undefined && Date.now() > deadlineMs) return false
    if (legCrossesLand(waypoints[i], waypoints[i + 1], landRings)) return false
  }
  return true
}

/**
 * True when any sampled point along the route sits on OSM water rather than inside an
 * ENC deep-enough area, so a route whose waypoints land in ENC water but whose legs
 * pass through OSM-only water still earns the depth-unverified caveat. Samples at the
 * same spacing as the re-check, so a depth-unverified interior leg is not missed.
 */
function usedOsmWater (
  waypoints: Position[], charted: ChartedAreas, osm: OsmAreas, contour: number, sampleSpacingMeters: number
): boolean {
  if (osm.water.length === 0) return false
  const spacing = Math.max(1, sampleSpacingMeters)
  const inEncDeep = (lon: number, lat: number): boolean => charted.depthAreas.some((area) => {
    if (!pointInRings(lon, lat, area.rings)) return false
    const drval1 = area.depthRange?.shallowMeters
    return drval1 !== undefined && drval1 >= contour
  })
  for (let i = 0; i + 1 < waypoints.length; i += 1) {
    for (const p of [waypoints[i], ...sampleRhumbLeg(waypoints[i], waypoints[i + 1], spacing)]) {
      if (inEncDeep(p.longitude, p.latitude)) continue
      if (osm.water.some((w) => pointInRings(p.longitude, p.latitude, w.rings))) return true
    }
  }
  const last = waypoints[waypoints.length - 1]
  return !inEncDeep(last.longitude, last.latitude) && osm.water.some((w) => pointInRings(last.longitude, last.latitude, w.rings))
}
