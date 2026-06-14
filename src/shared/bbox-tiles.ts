/**
 * Split a bbox into sub-boxes no larger than maxSpanDegrees on either edge, so a
 * route-draft Overpass query covers a wide box completely rather than letting the
 * client's center clamp silently truncate it. A box already within the span
 * returns as a single tile.
 */

import type { Bbox } from './types.js'

/**
 * Assumes a normalized, non-antimeridian-crossing bbox (north >= south,
 * east >= west), which is what `positionToBbox` and `unionBbox` produce.
 */
export function tileBbox (bbox: Bbox, maxSpanDegrees: number): Bbox[] {
  const tiles: Bbox[] = []
  const latCount = Math.max(1, Math.ceil((bbox.north - bbox.south) / maxSpanDegrees))
  const lonCount = Math.max(1, Math.ceil((bbox.east - bbox.west) / maxSpanDegrees))
  const latStep = (bbox.north - bbox.south) / latCount
  const lonStep = (bbox.east - bbox.west) / lonCount
  for (let i = 0; i < latCount; i += 1) {
    for (let j = 0; j < lonCount; j += 1) {
      tiles.push({
        south: bbox.south + latStep * i,
        north: bbox.south + latStep * (i + 1),
        west: bbox.west + lonStep * j,
        east: bbox.west + lonStep * (j + 1)
      })
    }
  }
  return tiles
}
