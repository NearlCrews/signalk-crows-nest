/**
 * natural=coastline Overpass query for a bbox land check. An internal
 * capability, not published as POIs, mirroring how depth-area-query.ts sits
 * under inputs/noaa-enc. Tiles a wide bbox into sub-boxes no larger than the
 * Overpass client's clamp so coverage is never silently truncated.
 */

import type { OverpassClient, CoastlineWay } from './overpass-client.js'
import { MAX_BBOX_SPAN_DEGREES } from './overpass-client.js'
import { tileBbox } from '../../shared/bbox-tiles.js'
import type { Bbox } from '../../shared/types.js'

export async function queryCoastline (
  client: OverpassClient, bbox: Bbox, signal?: AbortSignal
): Promise<CoastlineWay[]> {
  const tiles = tileBbox(bbox, MAX_BBOX_SPAN_DEGREES)
  const perTile = await Promise.all(tiles.map((t) => client.listCoastlineWays(t, signal)))
  return perTile.flat()
}
