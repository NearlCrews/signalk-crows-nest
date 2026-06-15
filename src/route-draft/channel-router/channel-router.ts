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
import { buildNavGrid, type NavGrid } from './nav-grid.js'
import { findPath } from './astar.js'
import { simplifyPath } from './path-simplify.js'
import { queryWaterAreas, type OsmAreas } from './osm-water-query.js'

/** The OSM water-and-land query, matching {@link queryWaterAreas}; injected so tests stub it. */
export type QueryWaterAreas = (
  client: OverpassClient, bbox: Bbox, signal?: AbortSignal, logger?: Logger
) => Promise<OsmAreas>

/** The result of {@link routeChannel}: the water route, or the reason it could not build one. */
export type ChannelRouteResult =
  | { ok: true, waypoints: Position[], usedOsmWater: boolean }
  | { ok: false, reason: 'no-coverage' | 'no-path' | 'unsnappable' | 'land-leg' | 'fetch-failed' }

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
 * Maximum span, in degrees, of the waypoint-derived bbox on either edge. A wider
 * window is declined before any fetch: it catches a cross-antimeridian union (a near
 * 360-degree span) and a passage too large for the grid to resolve at the cell floor.
 */
const MAX_BBOX_SPAN_DEG = 8

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
  // Decline a degenerate, cross-antimeridian, or oversized bbox BEFORE any fetch, so a
  // stray far waypoint cannot fan the water query into many tiles or waste the ENC fetch.
  if (
    !(bbox.east > bbox.west) || !(bbox.north > bbox.south) ||
    (bbox.east - bbox.west) > MAX_BBOX_SPAN_DEG || (bbox.north - bbox.south) > MAX_BBOX_SPAN_DEG
  ) {
    return { ok: false, reason: 'no-coverage' }
  }

  // Fetch both sources concurrently. ENC fetch never rejects (it returns undefined when
  // every band failed); the OSM query rejects only when every tile failed. Both failing
  // is fetch-failed; otherwise an empty-but-present result is honest no coverage.
  const [encSettled, osmSettled] = await Promise.allSettled([
    fetchEncAreas(deps, bbox, req.signal),
    deps.queryWaterAreas(deps.overpass, bbox, req.signal, deps.logger)
  ])
  const charted = encSettled.status === 'fulfilled' ? encSettled.value : undefined
  const osm = osmSettled.status === 'fulfilled' ? osmSettled.value : undefined
  if (charted === undefined && osm === undefined) return { ok: false, reason: 'fetch-failed' }
  const enc: ChartedAreas = charted ?? { depthAreas: [], landAreas: [] }
  const water: OsmAreas = osm ?? { water: [], land: [] }
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

  const epsilon = Math.min(SIMPLIFY_EPSILON_CELLS, SIMPLIFY_EPSILON_METERS / grid.cellMeters)
  const simplified = simplifyPath(cells, epsilon)
  // Pin the requested endpoints when they are already navigable (the navigator chose
  // them), else use the snapped cell center so the saved route never starts or ends on
  // land. The interior is the RDP of the A* path between the snapped cells.
  const startPos = grid.isNavigable(...grid.cellOf(req.from)) ? req.from : grid.cellCenter(start[0], start[1])
  const goalPos = grid.isNavigable(...grid.cellOf(req.to)) ? req.to : grid.cellCenter(goal[0], goal[1])
  const interior = simplified.slice(1, -1).map(([c, r]) => grid.cellCenter(c, r))
  const waypoints = [startPos, ...interior, goalPos]

  const contour = req.draftMeters + req.safetyMarginMeters
  if (!routeStaysOnWater(waypoints, enc, water, contour, grid.cellMeters / 2)) {
    return { ok: false, reason: 'land-leg' }
  }
  return { ok: true, waypoints, usedOsmWater: usedOsmWater(waypoints, enc, water, contour) }
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
 * Full-resolution navigability of a point: blocked inside any ENC land or OSM land,
 * blocked inside an ENC depth area that is drying, shallow, or of unknown depth
 * (shallowest wins), navigable inside an ENC deep-enough area or an OSM water polygon
 * (even-odd handles island holes), else not covered.
 */
function navigableAt (lon: number, lat: number, charted: ChartedAreas, osm: OsmAreas, contour: number): boolean {
  for (const land of charted.landAreas) if (pointInRings(lon, lat, land.rings)) return false
  for (const land of osm.land) if (pointInRings(lon, lat, land.rings)) return false
  let encDeep = false
  for (const area of charted.depthAreas) {
    if (!pointInRings(lon, lat, area.rings)) continue
    const drval1 = area.depthRange?.shallowMeters
    if (drval1 === undefined || drval1 < contour) return false
    encDeep = true
  }
  if (encDeep) return true
  for (const w of osm.water) if (pointInRings(lon, lat, w.rings)) return true
  return false
}

/**
 * True when every final leg stays on navigable water at polygon resolution: no leg
 * crosses an ENC or OSM land ring (exact), and every sampled point along each leg is
 * navigable (catches an RDP leg that leaves the water polygon or clips an island
 * hole, where a segment-versus-water-ring test would false-positive on a shared
 * boundary). Exported so the re-check is unit-tested directly.
 */
export function routeStaysOnWater (
  waypoints: Position[],
  charted: ChartedAreas,
  osm: OsmAreas,
  contourMeters: number,
  sampleSpacingMeters: number
): boolean {
  const landRings = [...charted.landAreas.map((a) => a.rings), ...osm.land.map((a) => a.rings)]
  const spacing = Math.max(1, sampleSpacingMeters)
  for (let i = 0; i + 1 < waypoints.length; i += 1) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const aPt = [a.longitude, a.latitude]
    const bPt = [b.longitude, b.latitude]
    if (landRings.some((rings) => segmentCrossesRings(aPt, bPt, rings))) return false
    for (const s of [a, ...sampleRhumbLeg(a, b, spacing), b]) {
      if (!navigableAt(s.longitude, s.latitude, charted, osm, contourMeters)) return false
    }
  }
  return true
}

/** True when any final waypoint sits on OSM water rather than inside an ENC deep-enough area. */
function usedOsmWater (waypoints: Position[], charted: ChartedAreas, osm: OsmAreas, contour: number): boolean {
  for (const wp of waypoints) {
    const inEncDeep = charted.depthAreas.some((area) => {
      if (!pointInRings(wp.longitude, wp.latitude, area.rings)) return false
      const drval1 = area.depthRange?.shallowMeters
      return drval1 !== undefined && drval1 >= contour
    })
    if (inEncDeep) continue
    if (osm.water.some((w) => pointInRings(wp.longitude, wp.latitude, w.rings))) return true
  }
  return false
}
