/**
 * Planar leg-vs-area geometry shared by the route-draft safety providers.
 *
 * The ring helpers (closed rings, wrapping the last vertex to the first) serve
 * the ENC depth-area and land-area polygons. The open-polyline helpers added
 * for the OpenSeaMap coastline check do NOT wrap, because an OSM coastline way
 * is an open line, not a closed ring. Both share the segmentsCross and orient2D
 * primitives so the two cannot drift.
 *
 * All inputs are GeoJSON [lon, lat] arrays (longitude is x, latitude is y),
 * matching the EncAreaPolygon ring shape. Tests at degree scale over short
 * coastal legs make a spherical correction unnecessary.
 */

import { sampleRhumbLeg } from '../geo/position-utilities.js'
import type { Position } from '../shared/types.js'

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
