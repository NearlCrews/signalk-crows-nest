/**
 * USACE locks and dams POI source.
 *
 * Wraps the ArcGIS REST client in a `PoiSource`. The bounding-box list query
 * fans out across the enabled layers (locks, dams) in parallel, tags every
 * feature with the source slug and the public-domain attribution, and stashes
 * the raw feature in an LRU detail cache so `getDetails` is usually a cache
 * hit. A miss re-queries the ArcGIS endpoint by `OBJECTID`. Outbound HTTP is
 * gated on `isInUsWaters()`: USACE structures are US-only, so a vessel that
 * has left US waters issues no query until it returns.
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
import {
  fetchDetailRecorded,
  fetchListWithOfflineFallback,
  staleSummariesWithinBbox,
  withListProvenance,
  type PoiSource
} from '../poi-source.js'
import { createBboxDebounceCache } from '../../shared/bbox-debounce.js'
import { MAX_BBOX_CACHE_ENTRIES } from '../../shared/cache.js'
import { createHydratedDetailCache } from '../../shared/hydrated-detail-cache.js'
import { splitOnFirstUnderscore } from '../../shared/namespaced-id.js'
import {
  isValidLatitude,
  isValidLongitude,
  toPositiveSafeInteger
} from '../../shared/numbers.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { shouldSkipOutsideUsWaters } from '../../shared/us-waters.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { USACE_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for USACE data, which is public domain. */
const USACE_ATTRIBUTION = 'US Army Corps of Engineers (public domain)'

/** Name of the JSON file the USACE detail store persists to. */
const STORE_FILE_NAME = 'usace-cache.json'

/** The layer keys a summary id can carry. */
const USACE_LAYER_KEYS = ['lock', 'dam'] as const

/** Cached entry: the layer the feature came from plus the feature itself. */
interface CachedFeature {
  layerKey: UsaceLayerKey
  feature: UsaceFeature
}

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
function isCachedFeature (value: unknown): value is CachedFeature {
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

/** Parse a summary id back into `(layerKey, objectId)` for a getById call. */
function parseSummaryId (id: string): { layerKey: UsaceLayerKey, objectId: number } | undefined {
  const split = splitOnFirstUnderscore(id)
  if (split === null) return undefined
  const layerKey = USACE_LAYER_KEYS.find((key) => key === split.prefix)
  if (layerKey === undefined) return undefined
  const objectId = toPositiveSafeInteger(split.remainder)
  return objectId !== null ? { layerKey, objectId } : undefined
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
    // USACE has no per-feature browser viewer, so the "view in a browser" link
    // falls back to an OpenSeaMap marker (see map-link.ts).
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
function toDetailView (cached: CachedFeature): PoiDetailView | null {
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
    // Normalized detail alongside the HTML: a structured client renders these
    // sections natively, a generic client renders `description`.
    sections: buildUsaceSections(layerKey, feature),
    skIcon: LAYER_SK_ICON[layerKey]
  }
}

/** The bbox-debounce cache's payload: the raw upstream features per enabled layer. */
type LayerFeatures = Array<{ layerKey: UsaceLayerKey, features: UsaceFeature[] }>

/** Create the USACE locks and dams POI source. */
export function createUsaceSource (config: UsaceSourceConfig): PoiSource {
  const { client, refreshSeconds, status, getCurrentPosition, dataDir } = config
  const lifecycle = new AbortController()
  // Detail cache, hydrated from the on-disk store so a cold start offline
  // still renders previously fetched features.
  const { cache, persist, close: closeCache } = createHydratedDetailCache<CachedFeature>({
    dataDir,
    fileName: STORE_FILE_NAME,
    isValue: isCachedFeature
  })
  // Per-bbox debounce: a Freeboard refresh burst on the same view reuses the
  // raw layer features for `refreshSeconds` before re-querying upstream.
  const bboxCache = createBboxDebounceCache<LayerFeatures>(refreshSeconds, MAX_BBOX_CACHE_ENTRIES)
  // The set of enabled layers is fixed for the life of the source.
  const layers = enabledLayers(config)

  // The offline fallback's per-source half: the cheap coordinate extraction
  // runs before the full summary build, so an out-of-box feature costs no
  // summary construction.
  const rebuildStale = (bbox: Bbox): PoiSummary[] =>
    staleSummariesWithinBbox(
      cache.values(),
      bbox,
      (cached) => {
        const latLon = featureLatLon(cached.feature)
        return latLon === null
          ? undefined
          : { latitude: latLon.lat, longitude: latLon.lon }
      },
      (cached) => toSummary(cached.layerKey, cached.feature)
    )

  return {
    id: USACE_SOURCE_ID,
    // `PoiSource.listPointsOfInterest` takes a comma-separated `poiTypes`
    // filter, but USACE fans out only to the configured layers instead: the
    // per-layer flags are baked in at construction, so the argument is
    // intentionally ignored for this source.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      lifecycle.signal.throwIfAborted()
      if (shouldSkipOutsideUsWaters(getCurrentPosition, status, USACE_SOURCE_ID)) {
        return withListProvenance([], 'skipped')
      }
      // No enabled layers is a configured-empty list, not a failure.
      if (layers.length === 0) {
        status.recordSkipped(USACE_SOURCE_ID, 'no structure layers enabled')
        return withListProvenance([], 'skipped')
      }
      const outcome = await fetchListWithOfflineFallback(
        status,
        USACE_SOURCE_ID,
        'USACE unreachable',
        () => bboxCache.get(bbox, async (fetchBbox) => {
          const results = await Promise.allSettled(
            layers.map(async (layerKey) => {
              const response = await client.queryLayer({
                layerKey,
                bbox: fetchBbox,
                signal: lifecycle.signal
              })
              return { layerKey, features: response.features }
            })
          )
          lifecycle.signal.throwIfAborted()
          const layerFeatures: LayerFeatures = []
          let anyLayerOk = false
          let firstRejection: unknown
          for (const result of results) {
            if (result.status === 'rejected') {
              status.recordError(
                USACE_SOURCE_ID,
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
          // registry's "any source succeeded" check trips correctly. A
          // rejection from the wrapped fetcher is not cached, so the next tick
          // retries the upstream.
          if (!anyLayerOk) {
            throw new Error(
              `Every enabled USACE layer query failed: ${String(firstRejection)}`
            )
          }
          return layerFeatures
        // Only cache a full result. A partial result (a layer transiently
        // failed) is returned for this call but not cached, so the failed
        // layer is retried on the next call rather than its POIs staying absent
        // for the whole debounce window.
        }, undefined, (layerFeatures) => layerFeatures.length === layers.length),
        () => rebuildStale(bbox)
      )
      lifecycle.signal.throwIfAborted()
      if (outcome.kind === 'stale') {
        return withListProvenance(outcome.summaries, 'stale')
      }
      const summaries: PoiSummary[] = []
      for (const { layerKey, features } of outcome.value.value) {
        for (const feature of features) {
          // A feature with no OBJECTID, no geometry, or out-of-range
          // coordinates is dropped rather than minting a marker whose
          // click-through would 404.
          const summary = toSummary(layerKey, feature)
          if (summary === null) continue
          // Reuse the cached wrapper when the feature reference is unchanged (a
          // bbox-debounce hit returns the same features): the store's
          // same-value persist guard then sees an identical reference, so a
          // stationary viewport does not rewrite an unchanged store file.
          const existing = cache.get(summary.id)
          const cachedFeature =
            existing !== undefined &&
            existing.feature === feature &&
            existing.layerKey === layerKey
              ? existing
              : { layerKey, feature }
          cache.set(summary.id, cachedFeature)
          persist(summary.id, cachedFeature)
          summaries.push(summary)
        }
      }
      return withListProvenance(summaries, outcome.value.provenance)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      lifecycle.signal.throwIfAborted()
      const hit = cache.get(id)
      if (hit !== undefined) {
        // A cache hit is not evidence of upstream reachability: a stale
        // apiReachable=false must not flip to true purely because the user
        // clicked a previously loaded marker.
        const view = toDetailView(hit)
        if (view !== null) return view
      }
      const parsed = parseSummaryId(id)
      if (parsed === undefined) {
        throw new Error(`Malformed USACE id "${id}"`)
      }
      // Gate outbound HTTP on the vessel position, mirroring the list path: a
      // detail click on a stale marker offshore must not issue a USACE
      // request. On a skip, behave as a miss and record the skip.
      if (shouldSkipOutsideUsWaters(getCurrentPosition, status, USACE_SOURCE_ID)) {
        throw new Error(`No USACE feature for "${id}"`)
      }
      // The shared wrapper owns the miss-vs-outage policy: the ArcGIS query
      // answering normally keeps the source reachable even when the feature is
      // gone, so the throws below cannot flip the status row to unreachable.
      const feature = await fetchDetailRecorded(status, USACE_SOURCE_ID,
        () => client.queryById({
          layerKey: parsed.layerKey,
          objectId: parsed.objectId,
          signal: lifecycle.signal
        }), lifecycle.signal)
      if (feature === undefined) {
        throw new Error(`No USACE feature for "${id}"`)
      }
      const cachedFeature = { layerKey: parsed.layerKey, feature }
      const view = toDetailView(cachedFeature)
      if (view === null) {
        throw new Error(`USACE feature "${id}" carries no usable geometry`)
      }
      cache.set(id, cachedFeature)
      persist(id, cachedFeature)
      return view
    },
    // The detail cache is the user-visible "POIs the plugin has loaded" number
    // on the status panel. The bbox-debounce cache is small and ephemeral, so
    // it is intentionally not added here.
    cacheSize: () => cache.size,
    close: () => {
      lifecycle.abort(new Error('USACE source closed'))
      // Flush any debounced write so a clean shutdown persists every feature
      // fetched during the run. The on-disk store is left in place so a later
      // cold start can hydrate it; only the in-memory caches are dropped.
      closeCache()
      bboxCache.clear()
    }
  }
}
