/**
 * OSM water-and-land area query for the channel router, worldwide.
 *
 * An internal capability, not published as POIs, mirroring how coastline-query.ts
 * wraps the Overpass client for the safety check. It tiles the route bbox, queries
 * each tile through the client's `listWaterAreas`, dedupes elements by OSM id across
 * tiles, and assembles each into a polygon with outer-ring-first-then-holes geometry,
 * returning navigable WATER polygons and LAND blocker polygons separately. The grid
 * consumes both as a plain `{ rings }` structural shape, so this module does not
 * couple to the ENC area types.
 *
 * It lives in the channel-router slice rather than under inputs/openseamap because
 * the ring assembly needs `pointInRings` from the route-draft geometry primitives
 * (an inner hole is kept only when it sits inside an assembled outer ring), and an
 * inputs module must not depend upward on route-draft. The thin HTTP query and
 * normalization stay in the Overpass client; only the geometry assembly is here.
 *
 * Bounds, for the Raspberry Pi request budget: the tile count is capped (a wider
 * route declines rather than queueing many paced Overpass requests), each tile query
 * is bounded by its own short AbortSignal folded onto the caller deadline, the
 * per-tile element count and per-polygon and total vertex counts are capped (a dense
 * ring is decimated, not dropped, since a coarse outline suffices at the cell size),
 * and a tile failure is tolerated unless every tile failed.
 */

import { combineAbortSignals } from '../../shared/abort.js'
import { tileBbox } from '../../shared/bbox-tiles.js'
import { MAX_BBOX_SPAN_DEGREES, type OsmAreaElement, type OverpassClient } from '../../inputs/openseamap/overpass-client.js'
import { pointInRings } from '../leg-geometry.js'
import type { Bbox, Logger } from '../../shared/types.js'

/** One assembled area polygon: GeoJSON `[lon, lat]` rings, outer first then holes. */
export interface AreaPolygon {
  rings: number[][][]
}

/** The OSM areas over a route bbox: navigable water polygons and land blocker polygons. */
export interface OsmAreas {
  water: AreaPolygon[]
  land: AreaPolygon[]
}

/**
 * Maximum tiles the water query covers. A regional route-draft window is one to a few
 * 2-degree tiles; a wider passage is too large for the request budget, so the query
 * returns empty (the router then declines for no coverage) rather than queueing many
 * paced Overpass requests on the shared, rate-limited client.
 */
export const MAX_WATER_TILES = 4

/**
 * Per-tile Overpass timeout, tighter than the safety check's, because the router runs
 * before the safety check and must leave it budget. Folded onto the caller deadline
 * per tile, so one slow tile aborts at this bound rather than holding the whole query.
 */
export const ROUTER_OSM_QUERY_TIMEOUT_MS = 4000

/** Per-tile element cap; a tile returning more is truncated and logged. */
const MAX_WATER_ELEMENTS_PER_TILE = 400
/** Per-polygon vertex cap; a denser ring is decimated to this many vertices. */
const MAX_VERTICES_PER_POLYGON = 20_000
/** Total assembled-vertex cap across all polygons; assembly stops once reached. */
const MAX_TOTAL_WATER_VERTICES = 200_000
/** Endpoint-match tolerance, in degrees, for stitching shared OSM nodes (about a centimeter). */
const JOIN_EPS = 1e-7

/**
 * Query and assemble the OSM water and land areas over `bbox`. Resolves with the
 * navigable water polygons and the land blocker polygons (either list possibly
 * empty). Rejects only when EVERY tile query failed, so a partial result from a slow
 * or failed tile still flows through; the caller treats an all-failed reject as a
 * fetch failure and a both-empty result as no coverage.
 */
export async function queryWaterAreas (
  client: OverpassClient,
  bbox: Bbox,
  signal?: AbortSignal,
  logger?: Logger
): Promise<OsmAreas> {
  const tiles = tileBbox(bbox, MAX_BBOX_SPAN_DEGREES)
  if (tiles.length > MAX_WATER_TILES) {
    logger?.debug(`channel-router water query declined: ${tiles.length} tiles exceeds the ${MAX_WATER_TILES} cap`)
    return { water: [], land: [] }
  }

  const seen = new Set<string>()
  const elements: OsmAreaElement[] = []
  let okTiles = 0
  let failedTiles = 0
  let lastError: unknown
  for (const tile of tiles) {
    try {
      const tileSignal = combineAbortSignals([signal, AbortSignal.timeout(ROUTER_OSM_QUERY_TIMEOUT_MS)])
      const tileElements = await client.listWaterAreas(tile, tileSignal)
      okTiles += 1
      let kept = 0
      for (const element of tileElements) {
        if (kept >= MAX_WATER_ELEMENTS_PER_TILE) {
          logger?.debug(`channel-router water tile truncated at ${MAX_WATER_ELEMENTS_PER_TILE} elements`)
          break
        }
        const key = `${element.element}:${element.id}`
        if (seen.has(key)) continue
        seen.add(key)
        elements.push(element)
        kept += 1
      }
    } catch (error) {
      failedTiles += 1
      lastError = error
      logger?.debug(`channel-router water tile failed: ${String(error)}`)
    }
  }
  if (okTiles === 0 && failedTiles > 0) throw lastError

  const water: AreaPolygon[] = []
  const land: AreaPolygon[] = []
  let totalVertices = 0
  for (const element of elements) {
    if (totalVertices >= MAX_TOTAL_WATER_VERTICES) {
      logger?.debug(`channel-router water assembly stopped at the ${MAX_TOTAL_WATER_VERTICES}-vertex cap`)
      break
    }
    const polygon = assemblePolygon(element)
    if (polygon === null) continue
    for (const ring of polygon.rings) totalVertices += ring.length
    ;(element.kind === 'water' ? water : land).push(polygon)
  }
  return { water, land }
}

/** True when two `[lon, lat]` points coincide within {@link JOIN_EPS}. */
function samePoint (a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) <= JOIN_EPS && Math.abs(a[1] - b[1]) <= JOIN_EPS
}

/** True when a chain is a closed ring (at least four points, first coincident with last). */
function isClosedRing (chain: number[][]): boolean {
  return chain.length >= 4 && samePoint(chain[0], chain[chain.length - 1])
}

/** Decimate a ring to at most `cap` vertices, keeping it closed. A ring within the cap is unchanged. */
function decimateRing (ring: number[][], cap: number): number[][] {
  if (ring.length <= cap) return ring
  const step = Math.ceil(ring.length / cap)
  const out: number[][] = []
  for (let i = 0; i < ring.length; i += step) out.push(ring[i])
  if (!samePoint(out[0], out[out.length - 1])) out.push([out[0][0], out[0][1]])
  return out
}

/** Close a standalone way into a ring, or null when it has too few vertices to be one. */
function closeWayRing (points: number[][]): number[][] | null {
  if (points.length < 3) return null
  const ring = samePoint(points[0], points[points.length - 1]) ? points : [...points, [points[0][0], points[0][1]]]
  return ring.length >= 4 ? ring : null
}

/**
 * Join `way` onto `chain` at a shared endpoint, reversing `way` when needed, or null
 * when no endpoint matches. Both are `[lon, lat]` polylines.
 */
function tryJoin (chain: number[][], way: number[][]): number[][] | null {
  const a = chain[0]
  const b = chain[chain.length - 1]
  const c = way[0]
  const d = way[way.length - 1]
  if (samePoint(b, c)) return [...chain, ...way.slice(1)]
  if (samePoint(b, d)) return [...chain, ...way.slice().reverse().slice(1)]
  if (samePoint(a, c)) return [...way.slice().reverse().slice(0, -1), ...chain]
  if (samePoint(a, d)) return [...way.slice(0, -1), ...chain]
  return null
}

/**
 * Stitch member ways head-to-tail into closed rings. A way already closed becomes a
 * ring on its own; chains that never close (a relation clipped at the bbox edge) are
 * dropped rather than force-closed, since force-closing across the edge could
 * fabricate area over land.
 */
function stitchRings (memberWays: number[][][]): number[][][] {
  const rings: number[][][] = []
  const pending = memberWays.filter((way) => way.length >= 2).map((way) => way.slice())
  while (pending.length > 0) {
    let chain = pending.pop() as number[][]
    let progress = true
    while (progress && !isClosedRing(chain)) {
      progress = false
      for (let i = 0; i < pending.length; i += 1) {
        const joined = tryJoin(chain, pending[i])
        if (joined !== null) {
          chain = joined
          pending.splice(i, 1)
          progress = true
          break
        }
      }
    }
    if (isClosedRing(chain)) rings.push(chain)
  }
  return rings
}

/**
 * Assemble one element into an {@link AreaPolygon}, or null when it yields no closed
 * outer ring. A way is closed into a single outer ring; a relation stitches its outer
 * members into outer rings and its inner members into hole rings, dropping an inner
 * ring not contained in any outer ring (the unsafe invalid-multipolygon case, where
 * an escaping inner would flip an island interior back to water under even-odd).
 */
function assemblePolygon (element: OsmAreaElement): AreaPolygon | null {
  if (element.element === 'way') {
    const ring = closeWayRing(element.points)
    return ring === null ? null : { rings: [decimateRing(ring, MAX_VERTICES_PER_POLYGON)] }
  }
  const outerMembers = element.members.filter((m) => m.role === 'outer').map((m) => m.points)
  const innerMembers = element.members.filter((m) => m.role === 'inner').map((m) => m.points)
  const outers = stitchRings(outerMembers)
  if (outers.length === 0) return null
  const inners = stitchRings(innerMembers).filter((inner) => pointInRings(inner[0][0], inner[0][1], outers))
  const rings = [...outers, ...inners].map((ring) => decimateRing(ring, MAX_VERTICES_PER_POLYGON))
  return { rings }
}
