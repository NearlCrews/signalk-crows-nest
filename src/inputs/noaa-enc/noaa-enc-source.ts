/**
 * NOAA ENC Direct POI source.
 *
 * Wraps the ArcGIS REST client in a `PoiSource` via the shared ArcGIS
 * factory (`arcgis-poi-source.ts`). The bounding-box list query fans out
 * across the enabled S-57 hazard layers (wrecks, obstructions, rocks) in
 * parallel, tags every feature with the source slug and the CC0 attribution,
 * and stashes the raw feature in an LRU detail cache so `getDetails` is
 * usually a cache hit. A miss re-queries the ArcGIS endpoint by ArcGIS
 * `OBJECTID`. Outbound HTTP is gated on `isInUsWaters()`.
 *
 * The summary id encodes the layer and the feature's ArcGIS object id, e.g.
 * `wreck_12345`. The slash form (`wreck/12345`) cannot be used because
 * SignalK serves resources at `/resources/notes/<id>` and a `/` inside the
 * id silently splits the path, matching the underscore convention the
 * OpenSeaMap source already uses.
 */

import type { EncDirectClient } from './enc-direct-client.js'
import type { EncFeature, EncLayerKey, ScaleBand } from './enc-direct-types.js'
import { humanizeCategory, LAYER_LABEL, LAYER_POI_TYPE, LAYER_SK_ICON, sordatToIsoTimestamp } from './s57-mapping.js'
import { renderEncDirectDetail } from './enc-direct-detail.js'
import { buildNoaaEncSections } from './noaa-enc-sections.js'
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
import { passesMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { NOAA_ENC_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for NOAA ENC Direct data. */
const NOAA_ENC_ATTRIBUTION = '© NOAA Office of Coast Survey (CC0)'

/** Name of the JSON file the NOAA ENC detail store persists to. */
const STORE_FILE_NAME = 'noaa-enc-cache.json'

/** The hazard layer keys a summary id can carry. */
const HAZARD_LAYER_KEYS = ['wreck', 'obstruction', 'rock'] as const

/** Dependencies for {@link createNoaaEncSource}. */
export interface NoaaEncSourceConfig {
  /** The ArcGIS REST client. */
  client: EncDirectClient
  /** The ENC scale band the source queries. */
  band: ScaleBand
  /** Include the wrecks layer in list queries. */
  includeWrecks: boolean
  /** Include the obstructions layer in list queries. */
  includeObstructions: boolean
  /** Include the underwater-rocks layer in list queries. */
  includeRocks: boolean
  /**
   * Hide features whose SORDAT survey year is older than this. `0` (the
   * off sentinel) disables the filter; features with no parseable SORDAT
   * are always included.
   */
  minimumYear: number
  /**
   * Minimum upstream-query interval per bbox, in seconds. A Freeboard
   * refresh burst on the same viewport reuses the cached summaries for
   * this long before re-querying ENC Direct. `0` (the off sentinel)
   * disables the cache and queries upstream on every list call.
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

/** Resolve the set of enabled hazard layers from the per-layer config flags. */
function enabledLayers (config: NoaaEncSourceConfig): EncLayerKey[] {
  const enabled: EncLayerKey[] = []
  if (config.includeWrecks) enabled.push('wreck')
  if (config.includeObstructions) enabled.push('obstruction')
  if (config.includeRocks) enabled.push('rock')
  return enabled
}

/**
 * Resolve the unique id for a feature. Prefers the GeoJSON top-level `id`
 * the ArcGIS service sets, falls back to the `OBJECTID` property; the two
 * always match on the live wire, but the fallback covers a partial response.
 */
function featureObjectId (feature: EncFeature): number | undefined {
  return toPositiveSafeInteger(feature.id) ??
    toPositiveSafeInteger(feature.properties.OBJECTID) ??
    undefined
}

/**
 * Narrow an unknown, JSON-parsed value to a {@link CachedFeature}. Checks the
 * hazard layer key and that the feature carries a `properties` bag, the two
 * things `toDetailView` dereferences, so a hydrated entry cannot crash the
 * renderer. Coordinates are validated later by `featureLatLon`, which treats a
 * malformed geometry as a miss.
 */
function isCachedFeature (value: unknown): value is CachedFeature<EncLayerKey, EncFeature> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const cached = value as { layerKey?: unknown, feature?: unknown }
  if (typeof cached.layerKey !== 'string' ||
    !HAZARD_LAYER_KEYS.some((key) => key === cached.layerKey)) {
    return false
  }
  const feature = cached.feature as { properties?: unknown } | null
  if (typeof feature !== 'object' || feature === null) {
    return false
  }
  return typeof feature.properties === 'object' && feature.properties !== null
}

/** Name for the popup: the OBJNAM string when present, layer label otherwise. */
function featureName (layerKey: EncLayerKey, feature: EncFeature): string {
  return humanizeCategory(feature.properties.OBJNAM) ?? LAYER_LABEL[layerKey]
}

/**
 * Extract the feature's `[longitude, latitude]` pair and validate the range.
 * Returns null when the geometry is absent, malformed, or carries
 * out-of-range coordinates: ArcGIS occasionally serves a feature with
 * `geometry: null` under certain projection failures, and a downstream
 * `NaN`-position POI would poison the proximity-alarm distance math.
 */
function featureLatLon (feature: EncFeature): { lat: number, lon: number } | null {
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
function toSummary (layerKey: EncLayerKey, feature: EncFeature): PoiSummary | null {
  const objectId = featureObjectId(feature)
  if (objectId === undefined) return null
  const latLon = featureLatLon(feature)
  if (latLon === null) return null
  const timestamp = sordatToIsoTimestamp(feature.properties.SORDAT)
  const summary: PoiSummary = {
    id: `${layerKey}_${objectId}`,
    type: LAYER_POI_TYPE,
    position: { latitude: latLon.lat, longitude: latLon.lon },
    name: featureName(layerKey, feature),
    source: NOAA_ENC_SOURCE_ID,
    url: openSeaMapMarkerUrl(latLon.lat, latLon.lon),
    attribution: NOAA_ENC_ATTRIBUTION,
    skIcon: LAYER_SK_ICON
  }
  if (timestamp !== undefined) summary.timestamp = timestamp
  return summary
}

/**
 * Build the source-agnostic detail view for one cached feature. Returns
 * null when the feature's coordinates are unusable; the caller treats this
 * the same as a cache miss.
 */
function toDetailView (cached: CachedFeature<EncLayerKey, EncFeature>): PoiDetailView | null {
  const { layerKey, feature } = cached
  const latLon = featureLatLon(feature)
  if (latLon === null) return null
  const description = renderEncDirectDetail(layerKey, feature.properties)
  const timestamp = sordatToIsoTimestamp(feature.properties.SORDAT)
  const view: PoiDetailView = {
    name: featureName(layerKey, feature),
    position: { latitude: latLon.lat, longitude: latLon.lon },
    type: LAYER_POI_TYPE,
    url: openSeaMapMarkerUrl(latLon.lat, latLon.lon),
    source: NOAA_ENC_SOURCE_ID,
    attribution: NOAA_ENC_ATTRIBUTION,
    description,
    sections: buildNoaaEncSections(layerKey, feature),
    skIcon: LAYER_SK_ICON
  }
  if (timestamp !== undefined) view.timestamp = timestamp
  return view
}

/** Create the NOAA ENC Direct POI source. */
export function createNoaaEncSource (config: NoaaEncSourceConfig): PoiSource {
  const { client, band, minimumYear, refreshSeconds, status, getCurrentPosition, dataDir } = config
  const layers = enabledLayers(config)
  const summaryFilter = (summary: PoiSummary): boolean =>
    passesMinimumYear(summary.timestamp, minimumYear)

  const arcGisConfig: ArcGisSourceConfig<EncLayerKey, EncFeature> = {
    sourceId: NOAA_ENC_SOURCE_ID,
    storeFileName: STORE_FILE_NAME,
    sourceLabel: 'NOAA ENC',
    noLayersSkipReason: 'no ENC layers enabled',
    layerKeys: HAZARD_LAYER_KEYS,
    layers,
    refreshSeconds,
    status,
    getCurrentPosition,
    dataDir,
    fetchLayerFeatures: async (layerKey, bbox, signal) => {
      const response = await client.queryLayer({ band, layerKey, bbox, signal })
      return response.features
    },
    fetchFeatureById: async (layerKey, objectId, signal) => {
      return client.queryById({ band, layerKey, objectId, signal })
    },
    featureLatLon,
    isCachedFeature,
    toSummary,
    toDetailView,
    summaryFilter
  }

  return createArcGisPoiSource(arcGisConfig)
}
