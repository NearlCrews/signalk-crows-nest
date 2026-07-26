/**
 * USACE locks and dams POI source.
 *
 * Wraps the ArcGIS REST client in a `PoiSource` via the shared ArcGIS
 * factory (`arcgis-poi-source.ts`). The bounding-box list query fans out
 * across the enabled layers (locks, dams) in parallel, tags every feature with
 * the source slug and the public-domain attribution, and stashes the raw
 * feature in an LRU detail cache so `getDetails` is usually a cache hit.
 * A miss re-queries the ArcGIS endpoint by `OBJECTID`. Outbound HTTP is gated
 * on `isInUsWaters()`: USACE structures are US-only, so a vessel that has left
 * US waters issues no query until it returns.
 *
 * The summary id encodes the layer and the feature's ArcGIS object id, e.g.
 * `lock_203` or `dam_64270`. The slash form cannot be used because SignalK
 * serves resources at `/resources/notes/<id>` and a `/` inside the id splits
 * the path, matching the underscore convention the OpenSeaMap and NOAA ENC
 * sources already use.
 */

import type { UsaceClient } from './usace-client.js'
import type { UsaceFeature, UsaceLayerKey } from './usace-types.js'
import { LAYER_LABEL, LAYER_POI_TYPE, LAYER_SK_ICON, structureName } from './usace-mapping.js'
import { renderUsaceDetail } from './usace-detail.js'
import { buildUsaceSections } from './usace-sections.js'
import type { PoiSource } from '../poi-source.js'
import {
  createArcGisPoiSource,
  type ArcGisSourceConfig,
  type CachedFeature
} from '../arcgis-poi-source.js'
import {
  isValidLatitude,
  isValidLongitude,
  toPositiveSafeInteger
} from '../../shared/numbers.js'
import type { PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { USACE_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for USACE data, which is public domain. */
const USACE_ATTRIBUTION = 'US Army Corps of Engineers (public domain)'

/** Name of the JSON file the USACE detail store persists to. */
const STORE_FILE_NAME = 'usace-cache.json'

/** The layer keys a summary id can carry. */
const USACE_LAYER_KEYS = ['lock', 'dam'] as const

/** Dependencies for {@link createUsaceSource}. */
export interface UsaceSourceConfig {
  /** The ArcGIS REST client. */
  client: UsaceClient
  /** Include the locks layer in list queries. */
  includeLocks: boolean
  /** Include the dams layer in list queries. */
  includeDams: boolean
  /**
   * Minimum upstream-query interval per bbox, in seconds. A Freeboard refresh
   * burst on the same viewport reuses the cached features for this long before
   * re-querying USACE. `0` (the off sentinel) disables the cache and queries
   * upstream on every list call.
   */
  refreshSeconds: number
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /** Returns the most recent vessel position, or undefined when unknown. */
  getCurrentPosition: () => Position | undefined
  /**
   * Plugin data directory, for the on-disk detail store that survives a
   * restart. Optional so a fixture that does not exercise persistence can omit
   * it; the production input module always supplies it. When absent the source
   * runs in memory only.
   */
  dataDir?: string
}

/** Resolve the set of enabled layers from the per-layer config flags. */
function enabledLayers (config: UsaceSourceConfig): UsaceLayerKey[] {
  const enabled: UsaceLayerKey[] = []
  if (config.includeLocks) enabled.push('lock')
  if (config.includeDams) enabled.push('dam')
  return enabled
}

/**
 * Resolve the unique id for a feature. Prefers the GeoJSON top-level `id` the
 * ArcGIS service sets, falls back to the `OBJECTID` property; the two always
 * match on the live wire, but the fallback covers a partial response.
 */
function featureObjectId (feature: UsaceFeature): number | undefined {
  return toPositiveSafeInteger(feature.id) ??
    toPositiveSafeInteger(feature.properties.OBJECTID) ??
    undefined
}

/**
 * Narrow an unknown, JSON-parsed value to a {@link CachedFeature}. Checks the
 * layer key and that the feature carries a `properties` bag, the two things
 * `toDetailView` dereferences, so a hydrated entry cannot crash the renderer.
 * Coordinates are validated later by `featureLatLon`, which treats a malformed
 * geometry as a miss.
 */
function isCachedFeature (value: unknown): value is CachedFeature<UsaceLayerKey, UsaceFeature> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const cached = value as { layerKey?: unknown, feature?: unknown }
  if (typeof cached.layerKey !== 'string' ||
    !USACE_LAYER_KEYS.some((key) => key === cached.layerKey)) {
    return false
  }
  const feature = cached.feature as { properties?: unknown } | null
  if (typeof feature !== 'object' || feature === null) {
    return false
  }
  return typeof feature.properties === 'object' && feature.properties !== null
}

/** Name for the popup: the structure name when present, layer label otherwise. */
function featureName (layerKey: UsaceLayerKey, feature: UsaceFeature): string {
  return structureName(layerKey, feature.properties) ?? LAYER_LABEL[layerKey]
}

/**
 * Extract the feature's `[longitude, latitude]` pair and validate the range.
 * Returns null when the geometry is absent, malformed, or carries
 * out-of-range coordinates, so a downstream `NaN`-position POI cannot poison
 * the proximity-alarm distance math.
 */
function featureLatLon (feature: UsaceFeature): { lat: number, lon: number } | null {
  const coords = feature.geometry?.coordinates
  if (coords === undefined || coords === null) return null
  const [lon, lat] = coords
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) return null
  return { lat, lon }
}

/**
 * Build the source-agnostic list summary for one feature. Returns null when
 * the feature is unusable (no OBJECTID, malformed geometry, out-of-range
 * coordinates) so the caller can drop the row rather than mint a fake
 * `<layer>_unknown` id whose click-through 404s.
 */
function toSummary (layerKey: UsaceLayerKey, feature: UsaceFeature): PoiSummary | null {
  const objectId = featureObjectId(feature)
  if (objectId === undefined) return null
  const latLon = featureLatLon(feature)
  if (latLon === null) return null
  return {
    id: `${layerKey}_${objectId}`,
    type: LAYER_POI_TYPE[layerKey],
    position: { latitude: latLon.lat, longitude: latLon.lon },
    name: featureName(layerKey, feature),
    source: USACE_SOURCE_ID,
    url: openSeaMapMarkerUrl(latLon.lat, latLon.lon),
    attribution: USACE_ATTRIBUTION,
    skIcon: LAYER_SK_ICON[layerKey]
  }
}

/**
 * Build the source-agnostic detail view for one cached feature. Returns null
 * when the feature's coordinates are unusable; the caller treats this the same
 * as a cache miss.
 */
function toDetailView (cached: CachedFeature<UsaceLayerKey, UsaceFeature>): PoiDetailView | null {
  const { layerKey, feature } = cached
  const latLon = featureLatLon(feature)
  if (latLon === null) return null
  return {
    name: featureName(layerKey, feature),
    position: { latitude: latLon.lat, longitude: latLon.lon },
    type: LAYER_POI_TYPE[layerKey],
    url: openSeaMapMarkerUrl(latLon.lat, latLon.lon),
    source: USACE_SOURCE_ID,
    attribution: USACE_ATTRIBUTION,
    description: renderUsaceDetail(layerKey, feature.properties),
    sections: buildUsaceSections(layerKey, feature),
    skIcon: LAYER_SK_ICON[layerKey]
  }
}

/** Create the USACE locks and dams POI source. */
export function createUsaceSource (config: UsaceSourceConfig): PoiSource {
  const { client, refreshSeconds, status, getCurrentPosition, dataDir } = config
  const layers = enabledLayers(config)

  const arcGisConfig: ArcGisSourceConfig<UsaceLayerKey, UsaceFeature> = {
    sourceId: USACE_SOURCE_ID,
    storeFileName: STORE_FILE_NAME,
    sourceLabel: 'USACE',
    noLayersSkipReason: 'no structure layers enabled',
    layerKeys: USACE_LAYER_KEYS,
    layers,
    refreshSeconds,
    status,
    getCurrentPosition,
    dataDir,
    fetchLayerFeatures: async (layerKey, bbox, signal) => {
      const response = await client.queryLayer({ layerKey, bbox, signal })
      return response.features
    },
    fetchFeatureById: async (layerKey, objectId, signal) => {
      return client.queryById({ layerKey, objectId, signal })
    },
    featureLatLon,
    isCachedFeature,
    toSummary,
    toDetailView
  }

  return createArcGisPoiSource(arcGisConfig)
}
