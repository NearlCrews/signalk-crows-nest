/**
 * US Army Corps of Engineers ArcGIS REST client.
 *
 * Issues bbox-bounded `/query` requests against the two USACE point services
 * (the Navigation Data Center Locks FeatureServer and the National Inventory
 * of Dams MapServer) and returns standard GeoJSON features. The two services
 * live on different hosts with different path shapes, so the client keys each
 * layer to its own full `/query` endpoint in the default endpoint table rather
 * than deriving a path from a single base; a test points both layers at a
 * local server through `queryUrls`.
 *
 * ArcGIS caps a single response, so the client pages while the upstream returns
 * `exceededTransferLimit: true`. Every request threads an optional caller
 * `AbortSignal` so an abandoned scan cancels its in-flight work, mirroring the
 * NOAA ENC Direct client this one is modeled on. The plugin's own descriptive
 * `User-Agent` is sent on every request.
 */

import {
  arcgisByIdParams,
  arcgisEnvelopeParams,
  arcgisPagedQuery,
  arcgisQueryById
} from '../arcgis-query.js'
import type { Bbox } from '../../shared/types.js'
import type { UsaceFeature, UsaceLayerKey } from './usace-types.js'

/**
 * The full `/query` endpoint for each USACE layer, verified live. Locks come
 * from the Navigation Data Center Locks FeatureServer on the USACE ArcGIS
 * Online organization; dams from the National Inventory of Dams public
 * MapServer on the USACE geospatial server. Both are point layers that serve
 * `f=geojson`.
 */
const DEFAULT_QUERY_URLS: Readonly<Record<UsaceLayerKey, string>> = {
  lock: 'https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Locks/FeatureServer/0/query',
  dam: 'https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/MapServer/0/query'
}

/** Tags this feed's error messages and its timeout/abort reason. */
const UPSTREAM_LABEL = 'USACE'

export interface UsaceClient {
  /** Bbox query against one layer. Pages internally to completion. */
  queryLayer: (request: QueryRequest) => Promise<{ features: UsaceFeature[] }>
  /** Fetch a single feature by ArcGIS object id, or undefined when absent. */
  queryById: (request: QueryByIdRequest) => Promise<UsaceFeature | undefined>
}

export interface QueryRequest {
  layerKey: UsaceLayerKey
  bbox: Bbox
  /** Optional deadline signal; cancels the in-flight request and stops paging. */
  signal?: AbortSignal
}

export interface QueryByIdRequest {
  layerKey: UsaceLayerKey
  objectId: number
  /** Optional deadline signal; cancels the in-flight request. */
  signal?: AbortSignal
}

export interface UsaceClientConfig {
  /** Per-layer `/query` endpoint overrides, merged over the defaults (for tests). */
  queryUrls?: Partial<Record<UsaceLayerKey, string>>
}

export function createUsaceClient (config: UsaceClientConfig = {}): UsaceClient {
  const queryUrls = { ...DEFAULT_QUERY_URLS, ...config.queryUrls }
  return {
    async queryLayer ({ layerKey, bbox, signal }) {
      const base = queryUrls[layerKey]
      const features = await arcgisPagedQuery<UsaceFeature>({
        label: UPSTREAM_LABEL,
        context: layerKey,
        buildPageUrl: (offset) => `${base}?${arcgisEnvelopeParams(bbox, offset).toString()}`,
        signal
      })
      return { features }
    },
    async queryById ({ layerKey, objectId, signal }) {
      const url = `${queryUrls[layerKey]}?${arcgisByIdParams(objectId).toString()}`
      return arcgisQueryById<UsaceFeature>(url, UPSTREAM_LABEL, signal)
    }
  }
}
