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
import {
  arcgisByIdParams,
  arcgisEnvelopeParams,
  arcgisPagedQuery,
  arcgisQueryById
} from '../arcgis-query.js'
import type { Bbox } from '../../shared/types.js'

/**
 * Default ArcGIS REST host for the ENC Direct service. NOAA's own ENC Direct
 * documentation and the data.gov catalog publish `encdirect.noaa.gov` as the
 * access point, so it is the canonical, more future-proof host to depend on.
 * `gis.charttools.noaa.gov` is a live alias of the same service: both resolve
 * to the same address and return byte-identical responses for the same path,
 * so this default can move between them with no behavioral change.
 */
const DEFAULT_BASE_URL = 'https://encdirect.noaa.gov'

/** Tags this feed's error messages and its timeout/abort reason. */
const UPSTREAM_LABEL = 'ENC Direct'

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

/** The MapServer `/query` endpoint for a (band, layerId) with the given params. */
function layerQueryUrl (
  base: string,
  band: ScaleBand,
  layerId: number,
  params: URLSearchParams
): string {
  return `${base}/arcgis/rest/services/encdirect/enc_${band}/MapServer/${layerId}/query?${params.toString()}`
}

export function createEncDirectClient (
  config: EncDirectClientConfig = {}
): EncDirectClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  return {
    async queryLayer ({ band, layerKey, bbox, signal }) {
      const layerId = LAYER_IDS_BY_BAND[band][layerKey]
      const features = await arcgisPagedQuery<EncFeature>({
        label: UPSTREAM_LABEL,
        context: `${band}/${layerKey}`,
        buildPageUrl: (offset) => layerQueryUrl(baseUrl, band, layerId, arcgisEnvelopeParams(bbox, offset)),
        signal
      })
      return { features }
    },
    async queryById ({ band, layerKey, objectId, signal }) {
      const layerId = LAYER_IDS_BY_BAND[band][layerKey]
      const url = layerQueryUrl(baseUrl, band, layerId, arcgisByIdParams(objectId))
      return arcgisQueryById<EncFeature>(url, UPSTREAM_LABEL, signal)
    }
  }
}
