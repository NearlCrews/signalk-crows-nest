/**
 * Planar leg-vs-area geometry shared by the route-draft safety providers.
 *
 * The ring helpers (closed rings, wrapping the last vertex to the first) serve
 * the ENC depth-area and land-area polygons, sharing the segmentsCross and
 * orient2D primitives.
 *
 * All inputs are GeoJSON [lon, lat] arrays (longitude is x, latitude is y),
 * matching the EncAreaPolygon ring shape. Tests at degree scale over short
 * coastal legs make a spherical correction unnecessary.
 */

import { distanceMeters, positionToBbox, sampleRhumbLeg, unionBbox } from '../geo/position-utilities.js'
import type { Bbox, Position } from '../shared/types.js'

/**
 * True when `[lon, lat]` lies inside the polygon `rings` (outer ring with holes)
 * by the even-odd ray-cast rule. A point on a hole's interior is outside the
 * polygon. The rings are GeoJSON `[lon, lat]` arrays, the shape EncAreaPolygon
 * carries, so longitude is x and latitude is y. This is a planar test in
 * degree space; at the leg lengths the check works over the error is far below
 * the chart compilation scale, so a spherical correction is not worth its cost.
 */
export function pointInRings (lon: number, lat: number, rings: number[][][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      const intersects = (yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (intersects) inside = !inside
    }
  }
  return inside
}

/** Signed area of triangle `a, b, c` (the 2D cross product); its sign gives the turn direction. */
export function orient2D (a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/** True when the two planar segments `p1->p2` and `p3->p4` properly cross. */
export function segmentsCross (
  p1: number[], p2: number[], p3: number[], p4: number[]
): boolean {
  const d1 = orient2D(p3, p4, p1)
  const d2 = orient2D(p3, p4, p2)
  if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) return false
  const d3 = orient2D(p1, p2, p3)
  const d4 = orient2D(p1, p2, p4)
  return (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)
}

/** True when the segment `[a, b]` (each `[lon, lat]`) crosses any ring edge of the area. */
export function segmentCrossesRings (a: number[], b: number[], rings: number[][][]): boolean {
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      if (segmentsCross(a, b, ring[j], ring[i])) return true
    }
  }
  return false
}

/** The ordered `[lon, lat]` points along a leg: the endpoints plus the interior samples. */
export function legPolyline (from: Position, to: Position, spacingMeters: number): number[][] {
  const interior = sampleRhumbLeg(from, to, spacingMeters)
  const polyline: number[][] = [[from.longitude, from.latitude]]
  for (const p of interior) polyline.push([p.longitude, p.latitude])
  polyline.push([to.longitude, to.latitude])
  return polyline
}

/**
 * The cumulative great-circle distance to each leg's start, one entry per leg
 * (index i is the distance from the route start to waypoint i). Great-circle,
 * not rhumb, so it matches the along-track distance scanRouteCorridor reports.
 * Shared by the route-draft safety providers' hazard scans.
 */
export function cumulativeLegStartMeters (waypoints: Position[]): number[] {
  const starts: number[] = []
  let accumulated = 0
  for (let leg = 0; leg + 1 < waypoints.length; leg += 1) {
    starts.push(accumulated)
    accumulated += distanceMeters(waypoints[leg], waypoints[leg + 1])
  }
  return starts
}

/**
 * The leg index a corridor hazard falls on, from its along-track distance and
 * the prebuilt cumulative leg-start distances. A point on a leg boundary is
 * attributed to the earlier leg, matching the original accumulation. Shared by
 * the route-draft safety providers' hazard scans.
 */
export function legForAlongTrack (legStartMeters: number[], alongTrackMeters: number): number {
  for (let leg = 0; leg + 1 < legStartMeters.length; leg += 1) {
    if (alongTrackMeters <= legStartMeters[leg + 1]) return leg
  }
  return legStartMeters.length - 1
}

/**
 * The leg's bounding box, expanded by `standoffMeters` so a near-miss area or
 * coastline either side of the leg is in range. positionToBbox encloses a circle
 * of the given radius around a point; the union of the two endpoint boxes covers
 * the whole leg plus the standoff margin either side. Shared by the route-draft
 * safety providers' per-leg land checks.
 */
export function legBbox (from: Position, to: Position, standoffMeters: number): Bbox {
  return unionBbox(
    positionToBbox(from, standoffMeters),
    positionToBbox(to, standoffMeters)
  )
}

/**
 * The bounding box enclosing a `halfWidthMeters` corridor around every waypoint
 * of a route, the union of each waypoint's enclosing box. Shared by the
 * route-draft safety providers' route-wide hazard scans. Throws on an empty
 * waypoint list, since there is no box to seed.
 */
export function routeBbox (waypoints: Position[], halfWidthMeters: number): Bbox {
  let bbox = positionToBbox(waypoints[0], halfWidthMeters)
  for (let i = 1; i < waypoints.length; i += 1) {
    bbox = unionBbox(bbox, positionToBbox(waypoints[i], halfWidthMeters))
  }
  return bbox
}
