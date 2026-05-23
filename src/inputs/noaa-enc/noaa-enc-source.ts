/**
 * NOAA ENC Direct POI source.
 *
 * Wraps the ArcGIS REST client in a `PoiSource`. The bounding-box list query
 * fans out across the enabled hazard layers (wrecks, obstructions, rocks) in
 * parallel, tags every feature with the source slug and the CC0 attribution,
 * and stashes the raw feature in an LRU detail cache so `getDetails` is
 * usually a cache hit. A miss re-queries the ArcGIS endpoint by ArcGIS
 * `OBJECTID`. Outbound HTTP is gated on `isInUsWaters()`: a vessel that has
 * left US waters issues no list query against NOAA until it returns, even if
 * the bounding box still overlaps a US region.
 *
 * The summary id encodes the layer and the feature's ArcGIS object id, e.g.
 * `wreck_12345`. The slash form (`wreck/12345`) cannot be used because
 * SignalK serves resources at `/resources/notes/<id>` and a `/` inside the
 * id silently splits the path, matching the underscore convention the
 * OpenSeaMap source already uses.
 */

import { LRUCache } from 'lru-cache'
import type { EncDirectClient } from './enc-direct-client.js'
import type { EncFeature, EncLayerKey, ScaleBand } from './enc-direct-types.js'
import { layerPoiType, layerSkIcon, sordatToIsoTimestamp } from './s57-mapping.js'
import { renderEncDirectDetail } from './enc-direct-detail.js'
import type { PoiSource } from '../poi-source.js'
import { appendAttribution } from '../../shared/attribution.js'
import { MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { isInUsWaters } from '../../shared/us-waters.js'
import { filterByMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** Stable id of the NOAA ENC Direct source. */
export const NOAA_ENC_SOURCE_ID = 'noaaenc'

/** Human-readable attribution credit for NOAA ENC Direct data. */
export const NOAA_ENC_ATTRIBUTION = '© NOAA Office of Coast Survey (CC0)'

/** Layer-derived fallback name used when a feature has no OBJNAM. */
const LAYER_NAME: Readonly<Record<EncLayerKey, string>> = {
  wreck: 'Wreck',
  obstruction: 'Obstruction',
  rock: 'Rock'
}

/** Cached entry: the layer the feature came from plus the feature itself. */
interface CachedFeature {
  layerKey: EncLayerKey
  feature: EncFeature
}

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
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /** Returns the most recent vessel position, or undefined when unknown. */
  getCurrentPosition: () => Position | undefined
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
  if (typeof feature.id === 'number') return feature.id
  const fromProps = feature.properties.OBJECTID
  return typeof fromProps === 'number' ? fromProps : undefined
}

/** Build the registry-side summary id for a feature, e.g. `wreck_12345`. */
function summaryId (layerKey: EncLayerKey, feature: EncFeature): string {
  const objectId = featureObjectId(feature)
  return `${layerKey}_${objectId ?? 'unknown'}`
}

/** Parse a summary id back into `(layerKey, objectId)` for a getById call. */
function parseSummaryId (id: string): { layerKey: EncLayerKey, objectId: number } | undefined {
  const underscore = id.indexOf('_')
  if (underscore <= 0) return undefined
  const layerKey = id.slice(0, underscore) as EncLayerKey
  if (layerKey !== 'wreck' && layerKey !== 'obstruction' && layerKey !== 'rock') {
    return undefined
  }
  const objectId = Number.parseInt(id.slice(underscore + 1), 10)
  return Number.isFinite(objectId) ? { layerKey, objectId } : undefined
}

/** Name for the popup: the OBJNAM string when present, layer label otherwise. */
function featureName (layerKey: EncLayerKey, feature: EncFeature): string {
  const objnam = feature.properties.OBJNAM
  if (typeof objnam === 'string') {
    const trimmed = objnam.trim()
    if (trimmed.length > 0) return trimmed
  }
  return LAYER_NAME[layerKey]
}

/** Public ENC Direct viewer URL centered on a feature's position. */
function viewerUrl (feature: EncFeature): string {
  const [lon, lat] = feature.geometry.coordinates
  return `https://encdirect.noaa.gov/?center=${lat},${lon}&zoom=15`
}

/** Build the source-agnostic list summary for one feature. */
function toSummary (layerKey: EncLayerKey, feature: EncFeature): PoiSummary {
  const [lon, lat] = feature.geometry.coordinates
  const timestamp = sordatToIsoTimestamp(feature.properties.SORDAT)
  const summary: PoiSummary = {
    id: summaryId(layerKey, feature),
    type: layerPoiType(layerKey),
    position: { latitude: lat, longitude: lon },
    name: featureName(layerKey, feature),
    source: NOAA_ENC_SOURCE_ID,
    url: viewerUrl(feature),
    attribution: NOAA_ENC_ATTRIBUTION,
    skIcon: layerSkIcon(layerKey)
  }
  if (timestamp !== undefined) summary.timestamp = timestamp
  return summary
}

/** Build the source-agnostic detail view for one cached feature. */
function toDetailView (cached: CachedFeature): PoiDetailView {
  const { layerKey, feature } = cached
  const [lon, lat] = feature.geometry.coordinates
  const description = appendAttribution(
    renderEncDirectDetail(layerKey, feature.properties),
    NOAA_ENC_ATTRIBUTION
  )
  const timestamp = sordatToIsoTimestamp(feature.properties.SORDAT)
  const view: PoiDetailView = {
    name: featureName(layerKey, feature),
    position: { latitude: lat, longitude: lon },
    type: layerPoiType(layerKey),
    url: viewerUrl(feature),
    source: NOAA_ENC_SOURCE_ID,
    attribution: NOAA_ENC_ATTRIBUTION,
    description,
    skIcon: layerSkIcon(layerKey)
  }
  if (timestamp !== undefined) view.timestamp = timestamp
  return view
}

/** Create the NOAA ENC Direct POI source. */
export function createNoaaEncSource (config: NoaaEncSourceConfig): PoiSource {
  const { client, band, minimumYear, status, getCurrentPosition } = config
  const cache = new LRUCache<string, CachedFeature>({ max: MAX_POI_CACHE_ENTRIES })

  return {
    id: NOAA_ENC_SOURCE_ID,
    // `PoiSource.listPointsOfInterest` takes a comma-separated `poiTypes`
    // filter, but ENC Direct fans out only to the configured hazard layers
    // instead: the per-layer flags are baked in at construction. The
    // `poiTypes` argument is therefore intentionally ignored for this source.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      const position = getCurrentPosition()
      if (position !== undefined && !isInUsWaters(position)) {
        status.recordSkipped(NOAA_ENC_SOURCE_ID, 'outside US waters')
        return []
      }
      const layers = enabledLayers(config)
      // No enabled layers is a configured-empty list, not a failure: return
      // empty so the aggregate sees a fulfilled empty result and the source
      // is correctly reachable.
      if (layers.length === 0) {
        return []
      }
      const results = await Promise.allSettled(
        layers.map(async (layerKey) => {
          const response = await client.queryLayer({ band, layerKey, bbox })
          return { layerKey, features: response.features }
        })
      )
      const summaries: PoiSummary[] = []
      let anyLayerOk = false
      let firstRejection: unknown
      for (const result of results) {
        if (result.status === 'rejected') {
          status.recordError(
            NOAA_ENC_SOURCE_ID,
            `Layer query failed: ${String(result.reason)}`
          )
          if (firstRejection === undefined) firstRejection = result.reason
          continue
        }
        anyLayerOk = true
        const { layerKey, features } = result.value
        for (const feature of features) {
          const id = summaryId(layerKey, feature)
          cache.set(id, { layerKey, feature })
          summaries.push(toSummary(layerKey, feature))
        }
      }
      // If every enabled layer rejected, the source itself failed: reject
      // rather than returning a fulfilled empty result, so the aggregate
      // registry's "any source succeeded" check trips correctly and
      // apiReachable is not flipped to true via recordListFetch(0).
      if (!anyLayerOk) {
        throw new Error(
          `Every enabled NOAA ENC layer query failed: ${String(firstRejection)}`
        )
      }
      // Year filter is applied source-side so the rest of the pipeline
      // (dedupe, notes output, alarms) never sees filtered features.
      return filterByMinimumYear(summaries, minimumYear)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const hit = cache.get(id)
      if (hit !== undefined) {
        // A cache hit is not evidence of upstream reachability: a stale
        // apiReachable=false must not flip to true purely because the user
        // clicked a previously loaded marker. Only a fresh network request
        // updates the status row.
        return toDetailView(hit)
      }
      const parsed = parseSummaryId(id)
      if (parsed === undefined) {
        throw new Error(`Malformed NOAA ENC id "${id}"`)
      }
      try {
        const feature = await client.queryById({
          band, layerKey: parsed.layerKey, objectId: parsed.objectId
        })
        if (feature === undefined) {
          throw new Error(`No NOAA ENC feature for "${id}"`)
        }
        const cached = { layerKey: parsed.layerKey, feature }
        cache.set(id, cached)
        status.recordDetailSuccess(NOAA_ENC_SOURCE_ID)
        return toDetailView(cached)
      } catch (error) {
        status.recordError(
          NOAA_ENC_SOURCE_ID,
          `Detail request failed: ${String(error)}`
        )
        throw error
      }
    },
    cacheSize: () => cache.size,
    close: () => { cache.clear() }
  }
}
