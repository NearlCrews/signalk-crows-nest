/**
 * NOAA ENC Direct ArcGIS REST client.
 *
 * Issues bbox-bounded `/query` requests against the per-scale-band ENC Direct
 * MapServers and returns standard GeoJSON features. ArcGIS caps a single
 * response at 1000 records, so the client pages while the upstream returns
 * `exceededTransferLimit: true`. The numeric layer id is resolved from
 * `(band, layerKey)` via `LAYER_IDS_BY_BAND`, so the call sites never
 * hard-code layer ids.
 *
 * Every request includes the bounding-box geometry filter: an unbounded
 * `where=1=1` query times out at the harbour scale band (observed during
 * research), so the client deliberately constructs the URL such that
 * `geometry` is always present and `where` never replaces it.
 *
 * The ENC Direct service requires a descriptive `User-Agent`: a request with
 * the default Node UA never returns. The plugin's own user-agent string is
 * sent on every request.
 */

import {
  LAYER_IDS_BY_BAND,
  type EncFeature,
  type EncLayerKey,
  type ScaleBand
} from './enc-direct-types.js'
import { requestText } from '../http-one-shot.js'
import type { Bbox } from '../../shared/types.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { MS_PER_MINUTE } from '../../shared/time.js'

/**
 * Default ArcGIS REST host for the ENC Direct service. NOAA's own ENC Direct
 * documentation and the data.gov catalog publish `encdirect.noaa.gov` as the
 * access point, so it is the canonical, more future-proof host to depend on.
 * `gis.charttools.noaa.gov` is a live alias of the same service: both resolve
 * to the same address and return byte-identical responses for the same path,
 * so this default can move between them with no behavioral change.
 */
const DEFAULT_BASE_URL = 'https://encdirect.noaa.gov'

/** ArcGIS' per-response cap. The client pages while the upstream signals more. */
const PAGE_SIZE = 1000

/**
 * Upper bound on pagination passes per `queryLayer` call. The largest ENC
 * layer observed live (coastal-band rocks) caps at ~43k features, eight pages
 * below this bound. A misbehaving server that pins `exceededTransferLimit:
 * true` forever (a CDN cache regression, a stuck cursor) would otherwise
 * loop indefinitely and exhaust memory; the bound trips first and rejects
 * with a clear error so the source records it and the caller backs off.
 */
const MAX_PAGES = 200

/**
 * Per-request timeout in milliseconds. A hung TCP connection (a silently
 * dropped TLS handshake, a black-hole proxy) would otherwise block the next
 * scan tick indefinitely. The shared `http-client.ts` already enforces this
 * for the queued sources; this raw client mirrors the policy.
 */
const REQUEST_TIMEOUT_MS = MS_PER_MINUTE

export interface EncDirectClient {
  /** Bbox query against one (band, layerKey). Pages internally to completion. */
  queryLayer: (request: QueryRequest) => Promise<{ features: EncFeature[] }>
  /** Fetch a single feature by ArcGIS object id, or undefined when absent. */
  queryById: (request: QueryByIdRequest) => Promise<EncFeature | undefined>
}

export interface QueryRequest {
  band: ScaleBand
  layerKey: EncLayerKey
  bbox: Bbox
  /** Optional deadline signal; cancels the in-flight request and stops paging. */
  signal?: AbortSignal
}

export interface QueryByIdRequest {
  band: ScaleBand
  layerKey: EncLayerKey
  objectId: number
  /** Optional deadline signal; cancels the in-flight request. */
  signal?: AbortSignal
}

export interface EncDirectClientConfig {
  baseUrl?: string
}

interface ArcGisFeatureCollection {
  features?: EncFeature[]
  exceededTransferLimit?: boolean
}

async function fetchJson (url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const response = await requestText(url, headers, REQUEST_TIMEOUT_MS, 'ENC Direct', signal)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`ENC Direct HTTP ${response.status} for ${url}`)
  }
  // JSON.parse only throws a SyntaxError (already an Error), so the parse is
  // returned directly: a try/catch that rethrows the same value would be a
  // no-op. The caller treats a parse failure as a failed layer query.
  return JSON.parse(response.body)
}

function buildBboxUrl (
  base: string,
  band: ScaleBand,
  layerId: number,
  bbox: Bbox,
  offset: number
): string {
  const params = new URLSearchParams({
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outFields: '*',
    returnGeometry: 'true',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE)
  })
  return `${base}/arcgis/rest/services/encdirect/enc_${band}/MapServer/${layerId}/query?${params.toString()}`
}

function buildByIdUrl (
  base: string,
  band: ScaleBand,
  layerId: number,
  objectId: number
): string {
  const params = new URLSearchParams({
    objectIds: String(objectId),
    outFields: '*',
    returnGeometry: 'true',
    f: 'geojson'
  })
  return `${base}/arcgis/rest/services/encdirect/enc_${band}/MapServer/${layerId}/query?${params.toString()}`
}

export function createEncDirectClient (
  config: EncDirectClientConfig = {}
): EncDirectClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const headers = { 'User-Agent': PLUGIN_USER_AGENT }
  return {
    async queryLayer ({ band, layerKey, bbox, signal }) {
      const layerId = LAYER_IDS_BY_BAND[band][layerKey]
      const all: EncFeature[] = []
      let offset = 0
      // Bounded pagination loop: a misbehaving server pinning
      // exceededTransferLimit forever would otherwise loop indefinitely.
      for (let page = 0; page < MAX_PAGES; page++) {
        // requestText rejects immediately when signal is already aborted, so the
        // continuation does not need its own pre-fetch abort guard.
        const url = buildBboxUrl(baseUrl, band, layerId, bbox, offset)
        const json = await fetchJson(url, headers, signal) as ArcGisFeatureCollection
        const features = json.features ?? []
        for (const feature of features) all.push(feature)
        if (json.exceededTransferLimit !== true || features.length === 0) {
          return { features: all }
        }
        offset += features.length
      }
      throw new Error(
        `ENC Direct pagination exceeded ${MAX_PAGES} pages for ${band}/${layerKey}; ` +
        'the upstream may be pinning exceededTransferLimit incorrectly'
      )
    },
    async queryById ({ band, layerKey, objectId, signal }) {
      const layerId = LAYER_IDS_BY_BAND[band][layerKey]
      const url = buildByIdUrl(baseUrl, band, layerId, objectId)
      const json = await fetchJson(url, headers, signal) as ArcGisFeatureCollection
      return (json.features ?? [])[0]
    }
  }
}
