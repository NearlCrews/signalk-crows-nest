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
import { LAYER_LABEL, LAYER_POI_TYPE, LAYER_SK_ICON, sordatToIsoTimestamp } from './s57-mapping.js'
import { renderEncDirectDetail } from './enc-direct-detail.js'
import { buildNoaaEncSections } from './noaa-enc-sections.js'
import { fetchDetailRecorded, type PoiSource } from '../poi-source.js'
import { createBboxDebounceCache } from '../../shared/bbox-debounce.js'
import { MAX_BBOX_CACHE_ENTRIES, MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import { splitOnFirstUnderscore } from '../../shared/namespaced-id.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { shouldSkipOutsideUsWaters } from '../../shared/us-waters.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import { passesMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { NOAA_ENC_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for NOAA ENC Direct data. */
const NOAA_ENC_ATTRIBUTION = '© NOAA Office of Coast Survey (CC0)'

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

/** Parse a summary id back into `(layerKey, objectId)` for a getById call. */
function parseSummaryId (id: string): { layerKey: EncLayerKey, objectId: number } | undefined {
  const split = splitOnFirstUnderscore(id)
  if (split === null) return undefined
  const layerKey = split.prefix as EncLayerKey
  if (layerKey !== 'wreck' && layerKey !== 'obstruction' && layerKey !== 'rock') {
    return undefined
  }
  const objectId = Number.parseInt(split.remainder, 10)
  return Number.isFinite(objectId) ? { layerKey, objectId } : undefined
}

/** Name for the popup: the OBJNAM string when present, layer label otherwise. */
function featureName (layerKey: EncLayerKey, feature: EncFeature): string {
  const objnam = feature.properties.OBJNAM
  if (typeof objnam === 'string') {
    const trimmed = objnam.trim()
    if (trimmed.length > 0) return trimmed
  }
  return LAYER_LABEL[layerKey]
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
    // NOAA's ENC Direct viewer has no per-feature deep link, so the "view in a
    // browser" link falls back to an OpenSeaMap marker (see map-link.ts).
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
function toDetailView (cached: CachedFeature): PoiDetailView | null {
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
    // Normalized detail alongside the HTML: a structured client renders these
    // sections natively, a generic client renders `description`.
    sections: buildNoaaEncSections(layerKey, feature),
    skIcon: LAYER_SK_ICON
  }
  if (timestamp !== undefined) view.timestamp = timestamp
  return view
}

/** Create the NOAA ENC Direct POI source. */
export function createNoaaEncSource (config: NoaaEncSourceConfig): PoiSource {
  const { client, band, minimumYear, refreshSeconds, status, getCurrentPosition } = config
  const cache = new LRUCache<string, CachedFeature>({ max: MAX_POI_CACHE_ENTRIES })
  // Per-bbox debounce: a Freeboard refresh burst on the same view reuses
  // the raw layer features for `refreshSeconds` before re-querying upstream.
  // The cache holds raw per-layer features (not summaries) so the per-call
  // tagging, detail-LRU repopulation, and year filter run outside the
  // cache. The detail cache above (LRU by feature id) is unrelated; this
  // one keys on the bounding-box string.
  type LayerFeatures = Array<{ layerKey: EncLayerKey, features: EncFeature[] }>
  const bboxCache = createBboxDebounceCache<LayerFeatures>(refreshSeconds, MAX_BBOX_CACHE_ENTRIES)
  // The set of enabled hazard layers is fixed for the life of the source,
  // so the array is built once at construction rather than on every list
  // call.
  const layers = enabledLayers(config)

  return {
    id: NOAA_ENC_SOURCE_ID,
    // `PoiSource.listPointsOfInterest` takes a comma-separated `poiTypes`
    // filter, but ENC Direct fans out only to the configured hazard layers
    // instead: the per-layer flags are baked in at construction. The
    // `poiTypes` argument is therefore intentionally ignored for this source.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      if (shouldSkipOutsideUsWaters(getCurrentPosition, status, NOAA_ENC_SOURCE_ID)) {
        return []
      }
      // No enabled layers is a configured-empty list, not a failure: return
      // empty so the aggregate sees a fulfilled empty result and the source
      // is correctly reachable.
      if (layers.length === 0) {
        return []
      }
      // Cache only the raw per-layer features. The per-call tagging, the
      // detail-LRU repopulation, and the year filter run OUTSIDE the cache
      // so a runtime config change to `minimumYear` takes effect on the
      // next list call rather than after the TTL, and so the detail LRU is
      // re-seeded on every cache hit rather than going stale alongside the
      // bbox cache.
      const cached = await bboxCache.get(bbox, async (fetchBbox) => {
        const results = await Promise.allSettled(
          layers.map(async (layerKey) => {
            const response = await client.queryLayer({ band, layerKey, bbox: fetchBbox })
            return { layerKey, features: response.features }
          })
        )
        const layerFeatures: LayerFeatures = []
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
          layerFeatures.push(result.value)
        }
        // If every enabled layer rejected, the source itself failed: reject
        // rather than returning a fulfilled empty result, so the aggregate
        // registry's "any source succeeded" check trips correctly and
        // apiReachable is not flipped to true via recordListFetch(0). A
        // rejection from the wrapped fetcher is not cached, so the next
        // tick retries the upstream.
        if (!anyLayerOk) {
          throw new Error(
            `Every enabled NOAA ENC layer query failed: ${String(firstRejection)}`
          )
        }
        return layerFeatures
      // Only cache a full result. A partial result (a layer transiently
      // failed) is returned for this call but not cached, so the failed
      // layer is retried on the next call rather than its POIs staying absent
      // for the whole debounce window.
      }, undefined, (layerFeatures) => layerFeatures.length === layers.length)
      const summaries: PoiSummary[] = []
      for (const { layerKey, features } of cached) {
        for (const feature of features) {
          // A feature with no OBJECTID, no geometry, or out-of-range
          // coordinates is dropped rather than minting an
          // `<layer>_unknown` marker whose click-through would 404.
          const summary = toSummary(layerKey, feature)
          if (summary === null) continue
          // Year filter is applied source-side so the rest of the pipeline
          // (dedupe, notes output, alarms) never sees filtered features,
          // and BEFORE the detail-cache insert: a filtered feature's marker
          // is never placed, so caching it would only evict entries a
          // click-through can actually reach.
          if (!passesMinimumYear(summary.timestamp, minimumYear)) continue
          cache.set(summary.id, { layerKey, feature })
          summaries.push(summary)
        }
      }
      return summaries
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const hit = cache.get(id)
      if (hit !== undefined) {
        // A cache hit is not evidence of upstream reachability: a stale
        // apiReachable=false must not flip to true purely because the user
        // clicked a previously loaded marker. Only a fresh network request
        // updates the status row.
        const view = toDetailView(hit)
        if (view !== null) return view
      }
      const parsed = parseSummaryId(id)
      if (parsed === undefined) {
        throw new Error(`Malformed NOAA ENC id "${id}"`)
      }
      // The shared wrapper owns the miss-vs-outage policy: the ArcGIS query
      // answering normally keeps the source reachable even when the feature
      // is gone or carries no usable geometry, so the throws below cannot
      // flip the status row to unreachable.
      const feature = await fetchDetailRecorded(status, NOAA_ENC_SOURCE_ID,
        () => client.queryById({
          band, layerKey: parsed.layerKey, objectId: parsed.objectId
        }))
      if (feature === undefined) {
        throw new Error(`No NOAA ENC feature for "${id}"`)
      }
      const cachedFeature = { layerKey: parsed.layerKey, feature }
      const view = toDetailView(cachedFeature)
      if (view === null) {
        throw new Error(`NOAA ENC feature "${id}" carries no usable geometry`)
      }
      cache.set(id, cachedFeature)
      return view
    },
    // The detail cache is the user-visible "POIs the plugin has loaded"
    // number on the status panel. The bbox-debounce cache is small and
    // ephemeral, so it is intentionally not added here.
    cacheSize: () => cache.size,
    close: () => {
      cache.clear()
      bboxCache.clear()
    }
  }
}
