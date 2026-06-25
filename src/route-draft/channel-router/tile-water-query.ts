/**
 * The channel router's worldwide water source, read from OpenMapTiles vector tiles.
 *
 * Given a route bbox it picks a zoom (the highest whose covering-tile count fits a
 * cap, so precision scales with how zoomed-in the route is), enumerates the
 * Web-Mercator tiles, fetches and decodes the `water` layer of each through the
 * vector-tile client, and returns the water polygons in the `{ rings }` structural
 * shape the grid consumes (a Polygon yields one polygon, a MultiPolygon several;
 * islands arrive as polygon holes, so there is no separate land list). Per-tile and
 * total vertex caps bound the decode and rasterization cost on the Pi, and an LRU
 * cache (water EXTENT only, never depth or hazards) makes repeat drafts in one area
 * fast. A failed tile is tolerated (its area is uncovered); only an all-tiles failure
 * rejects, which the orchestrator maps to a fetch failure.
 *
 * This uses Web-Mercator XYZ tiles, NOT the degree-tiling `shared/bbox-tiles.ts`
 * (that helper is for the Overpass path).
 */

import { LRUCache } from 'lru-cache'
import type { VectorTileClient, TileGeometry } from '../../inputs/vector-tiles/vector-tile-client.js'
import type { Bbox, Logger } from '../../shared/types.js'

/** One assembled water polygon: GeoJSON `[lon, lat]` rings, outer first then island holes. */
export interface AreaPolygon {
  rings: number[][][]
}

/** The water polygons over a route bbox. */
export interface TileWater {
  water: AreaPolygon[]
}

/** The water source: fetches and assembles tile water over a bbox, caching tiles. */
export interface TileWaterSource {
  queryTileWater: (bbox: Bbox, signal?: AbortSignal, logger?: Logger) => Promise<TileWater>
}

/** The OpenMapTiles layer carrying ocean, lakes, and rivers as land-excluding polygons. */
const WATER_LAYER = 'water'
/** Highest zoom to request (the layer's max; about a 2 km tile, detailed near shore). */
const MAX_ZOOM = 14
/** Lowest zoom to request; below this the route is larger than the grid resolves anyway. */
const MIN_ZOOM = 8
/** Covering-tile cap; the highest zoom whose tile count fits is chosen. */
const MAX_TILES = 16
/** Per-polygon vertex cap; a denser ring is decimated (a tile is far coarser than the grid cell resolves). */
const MAX_VERTICES_PER_POLYGON = 20_000
/** Total assembled-vertex cap across all tiles for one query, bounding decode and rasterize cost. */
const MAX_TOTAL_VERTICES = 200_000
/** Cache byte budget, sized so a worst-case dense tile set cannot exhaust the Pi. */
const CACHE_MAX_BYTES = 48 * 1024 * 1024
/** Approximate bytes per stored vertex (two doubles plus array overhead) for the cache size budget. */
const BYTES_PER_VERTEX = 24

const lonToTile = (lon: number, scale: number): number => Math.floor((lon + 180) / 360 * scale)
const latToTile = (lat: number, scale: number): number => {
  const r = lat * Math.PI / 180
  return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * scale)
}

/** The covering-tile count for a bbox at zoom `z`. */
function tileCount (bbox: Bbox, z: number): number {
  const scale = 2 ** z
  const nx = lonToTile(bbox.east, scale) - lonToTile(bbox.west, scale) + 1
  const ny = latToTile(bbox.south, scale) - latToTile(bbox.north, scale) + 1
  return nx * ny
}

/** The highest zoom in range whose covering-tile count fits the cap, or undefined when none does. */
export function pickZoom (bbox: Bbox): number | undefined {
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z -= 1) {
    if (tileCount(bbox, z) <= MAX_TILES) return z
  }
  return undefined
}

/** The integer `{ x, y }` tiles covering a bbox at zoom `z`. */
export function tilesForBbox (bbox: Bbox, z: number): Array<{ x: number, y: number }> {
  const scale = 2 ** z
  // Clamp to the valid tile range: an edge exactly at +180 lon (or a pole-ward
  // lat) maps to `scale`, one past the last tile, which would request a tile that
  // does not exist.
  const xMin = Math.max(0, lonToTile(bbox.west, scale))
  const xMax = Math.min(scale - 1, lonToTile(bbox.east, scale))
  const yMin = Math.max(0, latToTile(bbox.north, scale))
  const yMax = Math.min(scale - 1, latToTile(bbox.south, scale))
  const tiles: Array<{ x: number, y: number }> = []
  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      tiles.push({ x, y })
    }
  }
  return tiles
}

/** Decimate a ring to at most `cap` vertices, keeping it closed. Within the cap it is unchanged. */
function decimateRing (ring: number[][], cap: number): number[][] {
  if (ring.length <= cap) return ring
  const step = Math.ceil(ring.length / cap)
  const out: number[][] = []
  for (let i = 0; i < ring.length; i += step) out.push(ring[i])
  const first = out[0]
  const last = out[out.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]])
  return out
}

/** Convert decoded tile geometries into capped `AreaPolygon`s (a MultiPolygon becomes several). */
function toAreaPolygons (geoms: TileGeometry[]): AreaPolygon[] {
  const out: AreaPolygon[] = []
  for (const geom of geoms) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates as number[][][]] : geom.coordinates as number[][][][]
    for (const rings of polys) out.push({ rings: rings.map((ring) => decimateRing(ring, MAX_VERTICES_PER_POLYGON)) })
  }
  return out
}

/** Total vertex count of one water polygon. */
function vertexCountOne (poly: AreaPolygon): number {
  let n = 0
  for (const ring of poly.rings) n += ring.length
  return n
}

/** Total vertex count across a tile's water polygons (the LRU size unit). */
function vertexCount (polys: AreaPolygon[]): number {
  let n = 0
  for (const p of polys) n += vertexCountOne(p)
  return n
}

/**
 * Create a tile-water source over the given vector-tile client. The LRU caches the
 * decoded per-tile water polygons across requests, bounded by a byte budget.
 */
export function createTileWaterSource (client: VectorTileClient): TileWaterSource {
  const cache = new LRUCache<string, AreaPolygon[]>({
    maxSize: CACHE_MAX_BYTES,
    sizeCalculation: (polys) => Math.max(1, vertexCount(polys) * BYTES_PER_VERTEX)
  })

  async function tileWater (z: number, x: number, y: number, signal?: AbortSignal): Promise<AreaPolygon[]> {
    const key = `${z}/${x}/${y}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const polys = toAreaPolygons(await client.fetchLayer(z, x, y, WATER_LAYER, signal))
    cache.set(key, polys)
    return polys
  }

  async function queryTileWater (bbox: Bbox, signal?: AbortSignal, logger?: Logger): Promise<TileWater> {
    const zoom = pickZoom(bbox)
    if (zoom === undefined) {
      logger?.debug('tile-water: bbox too large to cover within the tile cap; no coverage')
      return { water: [] }
    }
    const tiles = tilesForBbox(bbox, zoom)
    const results = await Promise.allSettled(tiles.map((t) => tileWater(zoom, t.x, t.y, signal)))
    let ok = 0
    let failed = 0
    let lastError: unknown
    const water: AreaPolygon[] = []
    let total = 0
    let capHit = false
    for (const result of results) {
      if (result.status === 'rejected') {
        failed += 1
        lastError = result.reason
        logger?.debug(`tile-water: a tile fetch failed: ${String(result.reason)}`)
        continue
      }
      ok += 1
      if (capHit) continue
      for (const poly of result.value) {
        if (total >= MAX_TOTAL_VERTICES) {
          logger?.debug(`tile-water: assembly stopped at the ${MAX_TOTAL_VERTICES}-vertex cap`)
          capHit = true
          break
        }
        water.push(poly)
        total += vertexCountOne(poly)
      }
    }
    if (ok === 0 && failed > 0) throw lastError instanceof Error ? lastError : new Error('every water tile fetch failed')
    return { water }
  }

  return { queryTileWater }
}
