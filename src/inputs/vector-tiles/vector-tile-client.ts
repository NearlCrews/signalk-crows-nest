/**
 * HTTP client for OpenMapTiles-schema vector tiles (OpenFreeMap by default).
 *
 * The channel router reads the pre-clipped `water` layer from vector tiles instead
 * of fetching `natural=water` polygons from live Overpass. This client owns the
 * tile-specific HTTP and decode: it resolves the current tile-URL template from the
 * style's TileJSON (the live tiles sit under a versioned build path that ages out, so
 * the bare path returns empty and the template must be resolved, not hardcoded),
 * fetches a tile as binary, gunzips it when needed, decodes it with the Mapbox Vector
 * Tile stack, and returns one layer's features as GeoJSON geometry. Tile math and the
 * water assembly live in the channel-router's tile-water-query, not here.
 *
 * Tiles are CDN assets, so this client uses a tile-friendly HTTP profile (higher
 * concurrency, no inter-request spacing, one retry), NOT the Overpass etiquette
 * throttle. A descriptive User-Agent is sent on every request. The build-path
 * template is cached; a 404 (an aged-out build) invalidates it and re-resolves once.
 */

import { gunzipSync } from 'node:zlib'
import { assertResponseOk, createHttpClient, HttpError, type RateLimitOptions } from '../http-client.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { MS_PER_SECOND } from '../../shared/time.js'
import type { Logger } from '../../shared/types.js'

/** The default OpenFreeMap "liberty" style, the same source Binnacle renders. */
export const DEFAULT_TILE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** Per-request HTTP timeout for a tile or a style/TileJSON fetch. */
const REQUEST_TIMEOUT_MS = 6 * MS_PER_SECOND

/** Headers sent on every request; the descriptive User-Agent is required OSM-ecosystem etiquette. */
const BASE_HEADERS: Readonly<Record<string, string>> = { 'User-Agent': PLUGIN_USER_AGENT }

/**
 * Tile-CDN rate-limit profile, deliberately NOT the Overpass etiquette throttle: a
 * tile is a small static asset, so several fetch concurrently with no inter-request
 * spacing, and a tile is best-effort so it retries at most once.
 */
const DEFAULTS: RateLimitOptions = {
  maxConcurrency: 6,
  minDelayMs: 0,
  backoffBaseMs: 300,
  maxBackoffMs: 2000,
  maxRetries: 1,
  maxRetryAfterMs: 5000
}

/** A decoded polygon geometry from a tile layer, in lon/lat (GeoJSON winding via the decoder). */
export interface TileGeometry {
  type: 'Polygon' | 'MultiPolygon'
  /** A Polygon is `number[][][]` (rings); a MultiPolygon is `number[][][][]` (polygons of rings). */
  coordinates: number[][][] | number[][][][]
}

/** Public surface of the vector-tile client. */
export interface VectorTileClient {
  /**
   * Fetch and decode one layer of the tile at `z/x/y`, returning its polygon
   * geometries in lon/lat. Resolves the build-path template on first use (cached);
   * a 404 re-resolves it once. A tile with no such layer, or an empty tile, resolves
   * to an empty array. Rejects on a non-404 HTTP error, a network error, or a decode
   * failure. An optional `signal` lets a deadline cancel the request.
   */
  fetchLayer: (z: number, x: number, y: number, layerName: string, signal?: AbortSignal) => Promise<TileGeometry[]>
  /** Abort in-flight requests and stop retrying (call from plugin.stop). */
  close: () => void
}

/**
 * Read the tile-URL template from a style's vector source TileJSON. Intentionally takes no caller
 * signal: it runs as a shared one-shot bounded by the http client's own timeout and stop controller.
 */
async function resolveTemplate (
  fetchJson: (url: string, signal?: AbortSignal) => Promise<unknown>,
  styleUrl: string
): Promise<string> {
  const style = await fetchJson(styleUrl) as { sources?: Record<string, { type?: string, url?: string }> }
  const source = Object.values(style.sources ?? {}).find((s) => s?.type === 'vector' && typeof s.url === 'string')
  if (source?.url === undefined) throw new Error('vector-tile style has no vector source with a TileJSON url')
  const tileJson = await fetchJson(source.url) as { tiles?: unknown }
  const template = Array.isArray(tileJson.tiles) ? tileJson.tiles[0] : undefined
  if (typeof template !== 'string' || !template.includes('{z}')) {
    throw new Error('vector-tile TileJSON has no usable tile template')
  }
  return template
}

/**
 * The MVT decode stack (`@mapbox/vector-tile` plus `pbf`) is ESM-only, so it is loaded
 * with a dynamic import (the plugin builds to CommonJS, where a static import of an
 * ESM-only package would emit a failing require). Memoized: the modules are stateless,
 * so one load serves every client and request.
 */
interface DecodedFeature { toGeoJSON: (x: number, y: number, z: number) => { geometry: { type: string, coordinates: unknown } } }
interface DecodedLayer { length: number, feature: (index: number) => DecodedFeature }
interface DecodedTile { layers: Record<string, DecodedLayer | undefined> }
interface Decoder {
  VectorTile: new (reader: unknown) => DecodedTile
  PbfReader: new (buffer: Uint8Array) => unknown
}
let decoderPromise: Promise<Decoder> | undefined
async function loadDecoder (): Promise<Decoder> {
  // Reset the memo on a failed import so a transient load error does not poison every later call.
  decoderPromise ??= (async (): Promise<Decoder> => {
    const [vt, pbf] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')])
    return { VectorTile: vt.VectorTile, PbfReader: pbf.PbfReader } as unknown as Decoder
  })().catch((error) => { decoderPromise = undefined; throw error })
  return decoderPromise
}

/** Decode a tile body (gunzipped when gzip-magic is present) into one layer's polygon geometries. */
function decodeLayer (decoder: Decoder, bytes: Uint8Array, z: number, x: number, y: number, layerName: string): TileGeometry[] {
  if (bytes.length === 0) return []
  let buf: Uint8Array
  try {
    buf = bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(gunzipSync(bytes)) : bytes
  } catch (error) {
    // Corrupt gzip (a truncated download or CDN bit-rot) throws synchronously here; name the
    // tile in the message so the caller's log points at the bad tile rather than a bare decode panic.
    throw new Error(`vector-tile gunzip failed for ${z}/${x}/${y}: ${String(error)}`)
  }
  const layer = new decoder.VectorTile(new decoder.PbfReader(buf)).layers[layerName]
  if (layer === undefined) return []
  const out: TileGeometry[] = []
  for (let i = 0; i < layer.length; i += 1) {
    const geometry = layer.feature(i).toGeoJSON(x, y, z).geometry
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      out.push({ type: geometry.type, coordinates: geometry.coordinates as number[][][] | number[][][][] })
    }
  }
  return out
}

/**
 * Create a vector-tile client for the given style. Tile and TileJSON fetches go
 * through a tile-CDN HTTP profile; the build-path template is resolved lazily and
 * re-resolved once on a 404.
 */
export function createVectorTileClient (
  styleUrl: string,
  log: Logger,
  options: Partial<RateLimitOptions> = {}
): VectorTileClient {
  const http = createHttpClient(log, { label: 'VectorTile', requestTimeoutMs: REQUEST_TIMEOUT_MS, defaults: DEFAULTS }, options)
  let template: string | undefined
  let templatePromise: Promise<string> | undefined

  async function fetchJson (url: string, signal?: AbortSignal): Promise<unknown> {
    const response = await http.fetch(url, { headers: BASE_HEADERS, signal })
    await assertResponseOk(response, `vector-tile request failed for ${url}`)
    return response.json()
  }

  async function fetchTileBytes (url: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await http.fetch(url, { headers: BASE_HEADERS, signal })
    await assertResponseOk(response, `vector-tile request failed for ${url}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  function tileUrl (tmpl: string, z: number, x: number, y: number): string {
    return tmpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  }

  // Resolve the template once, sharing one in-flight resolution across concurrent callers
  // (a whole tile batch can 404 at once when a build ages out). The memo clears on
  // settle: success leaves `template` set so later callers short-circuit, failure clears
  // `templatePromise` so a retry re-attempts. The shared resolution deliberately does NOT
  // take a caller's signal: it is bounded by the http client's own request timeout and
  // plugin-stop controller, so one caller's deadline aborting cannot collaterally fail the
  // other concurrent callers awaiting the same template. Each caller's signal still bounds
  // its own tile fetch.
  async function ensureTemplate (): Promise<string> {
    if (template !== undefined) return template
    templatePromise ??= resolveTemplate(fetchJson, styleUrl)
      .then((t) => { template = t; return t })
      .finally(() => { templatePromise = undefined })
    return templatePromise
  }

  // Drop the cached template only if it is still the one that 404'd, so a concurrent
  // 404 that already refreshed it is not discarded back to a second resolution.
  function invalidateTemplate (stale: string): void {
    if (template === stale) template = undefined
  }

  async function fetchLayer (
    z: number, x: number, y: number, layerName: string, signal?: AbortSignal
  ): Promise<TileGeometry[]> {
    const decoder = await loadDecoder()
    const tmpl = await ensureTemplate()
    try {
      return decodeLayer(decoder, await fetchTileBytes(tileUrl(tmpl, z, x, y), signal), z, x, y, layerName)
    } catch (error) {
      // A 404 means the cached build path aged out: re-resolve once and retry.
      if (error instanceof HttpError && error.status === 404) {
        invalidateTemplate(tmpl)
        const fresh = await ensureTemplate()
        return decodeLayer(decoder, await fetchTileBytes(tileUrl(fresh, z, x, y), signal), z, x, y, layerName)
      }
      throw error
    }
  }

  return { fetchLayer, close: () => { http.close() } }
}
