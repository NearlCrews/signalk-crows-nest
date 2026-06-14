/**
 * Route-corridor hazard scan.
 *
 * Given the active route ahead of the vessel and a set of ActiveCaptain points
 * of interest, this module flags the Hazard, Bridge, and Lock points that lie
 * within a configurable corridor either side of the route. Each flagged point
 * carries the distance the vessel must still travel along the route to reach
 * it (the along-track distance) and, when a speed over ground is supplied, an
 * estimated time of arrival.
 *
 * The route is treated as a chain of great-circle legs. When the route carries
 * a vessel fix, leg zero runs from the vessel's current position to the first
 * upcoming waypoint, so the along-track distance is measured from where the
 * vessel is now; without a fix the legs run waypoint to waypoint. A point is
 * inside the corridor of a leg when its perpendicular (cross-track) distance to
 * that leg is within the corridor width and the foot of that perpendicular
 * falls between the leg's start and end. A point whose projection lies behind
 * the vessel, or beyond the end of the route, is not flagged.
 *
 * `scanRouteCorridor` is a pure function: it holds no state, performs no I/O,
 * and never mutates its inputs.
 */

import { distanceMeters, initialBearingRad, projectPointOntoLeg } from '../../geo/position-utilities.js'
import { positiveFiniteNumber } from '../../shared/numbers.js'
import type { CorridorPoi, PoiSummary, PoiType, Position, RoutePolyline } from '../../shared/types.js'

/**
 * The point-of-interest types the corridor scan flags. Marinas, anchorages,
 * and the rest are out of scope: only obstructions a vessel must plan around
 * raise a corridor hazard. The tuple is the single source of truth: the route
 * output reads it to size its fetch types, so the scan filter and the fetch
 * request cannot drift.
 */
export const CORRIDOR_POI_TYPES = ['Hazard', 'Bridge', 'Lock'] as const satisfies readonly PoiType[]

const CORRIDOR_POI_TYPE_SET: ReadonlySet<PoiType> = new Set<PoiType>(CORRIDOR_POI_TYPES)

/**
 * Build the leg-point chain for the route ahead. With a vessel fix the chain
 * runs from the vessel through every waypoint, so the along-track distance is
 * measured from where the vessel is now; without a fix it runs waypoint to
 * waypoint. Shared by the corridor scan and the route-hazard fetch box so the
 * two cannot drift.
 */
export function routeLegPoints (route: RoutePolyline): Position[] {
  return route.vesselPosition !== null
    ? [route.vesselPosition, ...route.waypoints]
    : [...route.waypoints]
}

/** Inputs for {@link scanRouteCorridor}. */
export interface RouteCorridorScanInput {
  /**
   * The active route ahead of the vessel, as produced by
   * `courseReader.getRouteAhead()`.
   */
  route: RoutePolyline
  /** The points of interest to test; non-corridor types are ignored. */
  pois: PoiSummary[]
  /** Half-width of the corridor, in meters, measured either side of the route. */
  corridorHalfWidthMeters: number
  /**
   * Vessel speed over ground, in meters per second, used to estimate arrival
   * times. When null, undefined, zero, or non-finite, no `etaSeconds` is
   * produced. `VesselState.speedOverGround` can be passed straight through.
   */
  speedOverGround?: number | null
}

/**
 * Scan the route corridor for Hazard, Bridge, and Lock points of interest.
 *
 * @param input - The route, points of interest, corridor width, and speed.
 * @returns The flagged points, sorted nearest-first by along-track distance.
 *   A point of interest that falls in the corridor of more than one leg is
 *   reported once, at its nearest projection.
 */
export function scanRouteCorridor (input: RouteCorridorScanInput): CorridorPoi[] {
  const { route, pois, corridorHalfWidthMeters, speedOverGround } = input

  // The legs run vessel to first waypoint to second waypoint, and so on. With
  // no vessel fix the first leg starts at the next waypoint instead, so the
  // along-track distance is then measured from there.
  const legPoints = routeLegPoints(route)
  // `!(corridorHalfWidthMeters > 0)` rather than `<= 0` so a non-finite width (NaN)
  // is rejected too: NaN fails every comparison, so a `<= 0` test would let it
  // through and then `abs(crossTrack) > NaN` would be false for every point,
  // silently flagging everything in the box regardless of the corridor.
  if (legPoints.length < 2 || !(corridorHalfWidthMeters > 0) || pois.length === 0) {
    return []
  }

  // Filter to corridor types once, not on every leg: only Hazard, Bridge, and
  // Lock can be flagged, and the per-leg type check would otherwise rerun for
  // every poi on every leg.
  const corridorPois = pois.filter((poi) => CORRIDOR_POI_TYPE_SET.has(poi.type))
  if (corridorPois.length === 0) {
    return []
  }

  // A null, undefined, zero, or non-finite speed yields no ETA. The shared
  // narrower returns null on every one of those, which maps to undefined.
  const sogForEta = positiveFiniteNumber(speedOverGround) ?? undefined

  // The best (nearest) projection found so far for each point of interest,
  // keyed by id. A point can fall in the corridor of more than one leg, near
  // a bend; only the nearest projection is reported.
  const flagged = new Map<string, CorridorPoi>()
  let routeDistanceToLegStart = 0

  for (let leg = 0; leg < legPoints.length - 1; leg++) {
    const start = legPoints[leg]
    const end = legPoints[leg + 1]
    const legLengthMeters = distanceMeters(start, end)
    // A zero-length or malformed leg has no direction to project onto; skip
    // it. routeDistanceToLegStart is unchanged because the leg adds no length.
    if (!Number.isFinite(legLengthMeters) || legLengthMeters === 0) {
      continue
    }

    // The leg bearing is invariant across every point on this leg, so compute
    // it once here rather than re-deriving it inside projectPointOntoLeg for
    // every corridor POI.
    const bearingToEnd = initialBearingRad(start, end)
    for (const poi of corridorPois) {
      const projection = projectPointOntoLeg(start, end, poi.position, bearingToEnd)
      if (!Number.isFinite(projection.crossTrackMeters) || !Number.isFinite(projection.alongTrackMeters)) {
        continue
      }
      // Outside the corridor, behind the leg start, or beyond the leg end.
      if (Math.abs(projection.crossTrackMeters) > corridorHalfWidthMeters) {
        continue
      }
      if (projection.alongTrackMeters < 0 || projection.alongTrackMeters > legLengthMeters) {
        continue
      }

      const alongTrackDistanceMeters = routeDistanceToLegStart + projection.alongTrackMeters
      const existing = flagged.get(poi.id)
      if (existing !== undefined) {
        // A POI exactly at a waypoint or sitting near a route bend can
        // project onto two consecutive legs. The first criterion is the
        // closer perpendicular distance (the leg the route actually passes
        // nearest the POI on), with along-track distance as the tiebreaker:
        // an earlier-encountered projection with a worse cross-track
        // distance would otherwise be reported in the warn message even
        // though the route passes much closer on a later leg.
        const existingAbsCross = Math.abs(existing.crossTrackDistanceMeters)
        const newAbsCross = Math.abs(projection.crossTrackMeters)
        if (existingAbsCross < newAbsCross) continue
        if (existingAbsCross === newAbsCross &&
            existing.alongTrackDistanceMeters <= alongTrackDistanceMeters) continue
      }

      const corridorPoi: CorridorPoi = {
        id: poi.id,
        type: poi.type,
        name: poi.name,
        position: poi.position,
        alongTrackDistanceMeters,
        crossTrackDistanceMeters: projection.crossTrackMeters
      }
      if (sogForEta !== undefined) {
        corridorPoi.etaSeconds = alongTrackDistanceMeters / sogForEta
      }
      flagged.set(poi.id, corridorPoi)
    }

    routeDistanceToLegStart += legLengthMeters
  }

  return [...flagged.values()].sort(
    (a, b) => a.alongTrackDistanceMeters - b.alongTrackDistanceMeters
  )
}
