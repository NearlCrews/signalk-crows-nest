/**
 * Shared ArcGIS POI source factory.
 *
 * NOAA ENC Direct and USACE are both ArcGIS REST point services that share the
 * same fan-out, bbox-debounce, hydrated-detail-cache, offline-fallback, and
 * US-waters gate patterns. This module exports a single factory that
 * parameterizes the source-specific bits, so the two source files are thin
 * wrappers that pass only their config.
 *
 * A layer-query request fans out across every enabled layer in parallel via
 * `Promise.allSettled`, collecting results and recording per-layer errors. If
 * every enabled layer rejects, the source itself fails; the shared cache
 * remembers the failure and holds retries for its cool-down, so a dead
 * upstream is not re-queried on every chartplotter poll. A partial failure
 * (some layers returned data) is served AND retained as a degraded result:
 * the cache shortens its freshness so the failed layer is retried through
 * background revalidation within a minute, rather than its POIs staying
 * absent for the whole debounce window or, worse, the whole fan-out being
 * re-launched on every poll.
 */

import {
  fetchDetailRecorded,
  fetchListWithOfflineFallback,
  staleSummariesWithinBbox,
  withListProvenance,
  type PoiSource
} from './poi-source.js'
import { createBboxDebounceCache } from '../shared/bbox-debounce.js'
import { MAX_BBOX_CACHE_ENTRIES } from '../shared/cache.js'
import { createHydratedDetailCache } from '../shared/hydrated-detail-cache.js'
import { splitOnFirstUnderscore } from '../shared/namespaced-id.js'
import { toPositiveSafeInteger } from '../shared/numbers.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../shared/types.js'
import { shouldSkipOutsideUsWaters } from '../shared/us-waters.js'
import type { PluginStatus } from '../status/plugin-status.js'

/**
 * A feature keyed by the layer it came from. The shared factory uses this
 * shape for the in-memory detail cache and the on-disk store.
 */
export interface CachedFeature<L extends string, F> {
  layerKey: L
  feature: F
}

/** The bbox-debounce cache's payload: raw upstream features per enabled layer. */
type LayerFeatures<L extends string, F> = Array<{ layerKey: L, features: F[] }>

/** Configuration for one ArcGIS-backed POI source. */
export interface ArcGisSourceConfig<L extends string, F> {
  /** Stable source id, e.g. `NOAA_ENC_SOURCE_ID`. */
  sourceId: string
  /** Name of the on-disk store file, e.g. `'noaa-enc-cache.json'`. */
  storeFileName: string
  /** Label used in log and error messages, e.g. `'NOAA ENC'`. */
  sourceLabel: string
  /** Skip reason logged when no layers are enabled, e.g. `'no ENC layers enabled'`. */
  noLayersSkipReason: string

  /** The set of recognized layer keys, used to validate cached values and parse summary ids. */
  readonly layerKeys: ReadonlyArray<L>
  /** The enabled layers, resolved at construction time from the config flags. */
  layers: L[]

  /** Minimum upstream-query interval per bbox, in seconds. `0` disables the cache. */
  refreshSeconds: number
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /** Returns the most recent vessel position, or undefined when unknown. */
  getCurrentPosition: () => Position | undefined
  /** Plugin data directory for the on-disk store. Optional for memory-only fixtures. */
  dataDir?: string

  /**
   * Fetch features for one layer within a bounding box. The factory calls
   * this once per enabled layer within `Promise.allSettled`; the closure
   * captures the source-specific client and any extra query parameters.
   */
  fetchLayerFeatures: (layerKey: L, bbox: Bbox, signal?: AbortSignal) => Promise<F[]>

  /**
   * Fetch a single feature by layer key and ArcGIS object id. The factory
   * calls this on a detail-cache miss.
   */
  fetchFeatureById: (layerKey: L, objectId: number, signal?: AbortSignal) => Promise<F | undefined>

  /**
   * Extract `[longitude, latitude]` from a feature and validate the range.
   * Returns null when the geometry is absent, malformed, or out of range.
   */
  featureLatLon: (feature: F) => { lat: number, lon: number } | null

  /**
   * Type guard that narrows an unknown JSON-parsed value to a valid cached
   * feature, so a hydrated disk entry cannot crash the renderer.
   */
  isCachedFeature: (value: unknown) => value is CachedFeature<L, F>

  /** Build a source-agnostic list summary for one feature. Returns null to drop the row. */
  toSummary: (layerKey: L, feature: F) => PoiSummary | null

  /** Build a source-agnostic detail view for one cached feature. Returns null on unusable geometry. */
  toDetailView: (cached: CachedFeature<L, F>) => PoiDetailView | null

  /**
   * Optional post-filter applied to every summary the source produces, both
   * from the live list path and the stale offline rebuild. Returns `true` to
   * keep the summary, `false` to drop it. Defaults to identity (keep all).
   */
  summaryFilter?: (summary: PoiSummary) => boolean

  /** Clock source for the bbox-debounce cache, injectable for tests. */
  now?: () => number
}

/**
 * Create an ArcGIS-backed POI source from the typed config. The returned
 * `PoiSource` fans list queries across every enabled layer in parallel, stashes
 * raw features in an LRU detail cache backed by an on-disk store, gates
 * outbound HTTP on `isInUsWaters`, and falls back to stale summaries from the
 * hydrated cache when upstream is unreachable.
 */
export function createArcGisPoiSource<L extends string, F> (
  cfg: ArcGisSourceConfig<L, F>
): PoiSource {
  const { sourceId, refreshSeconds, status, getCurrentPosition, dataDir } = cfg
  const summaryFilter = cfg.summaryFilter ?? (() => true)
  const lifecycle = new AbortController()

  // Detail cache, hydrated from the on-disk store so a cold start offline
  // still renders previously fetched features.
  const { cache, persist, close: closeCache } = createHydratedDetailCache<CachedFeature<L, F>>({
    dataDir,
    fileName: cfg.storeFileName,
    isValue: cfg.isCachedFeature
  })

  // Per-bbox debounce: a Freeboard refresh burst on the same viewport reuses
  // the raw layer features for `refreshSeconds` before re-querying upstream.
  // The cache holds raw per-layer features (not summaries) so the per-call
  // tagging, detail-LRU repopulation, and any filter run outside the cache.
  // The revalidation-error hook mirrors the OpenSeaMap and ActiveCaptain
  // wiring: without it a warm tile over a dead upstream would keep serving
  // 'local' forever with nothing recorded and the pill stuck on ok.
  const bboxCache = createBboxDebounceCache<LayerFeatures<L, F>>(
    refreshSeconds,
    MAX_BBOX_CACHE_ENTRIES,
    {
      now: cfg.now,
      onRevalidationError: (error) => {
        if (!lifecycle.signal.aborted) {
          status.recordError(
            sourceId,
            `Background ${cfg.sourceLabel} list refresh failed: ${String(error)}`
          )
        }
      }
    }
  )

  /** Parse a summary id back into `(layerKey, objectId)` for a getById call. */
  function parseSummaryId (id: string): { layerKey: L, objectId: number } | undefined {
    const split = splitOnFirstUnderscore(id)
    if (split === null) return undefined
    const layerKey = cfg.layerKeys.find((key) => key === split.prefix)
    if (layerKey === undefined) return undefined
    const objectId = toPositiveSafeInteger(split.remainder)
    return objectId !== null ? { layerKey, objectId } : undefined
  }

  // The offline fallback's per-source half: the cheap coordinate extraction
  // runs before the full summary build, so an out-of-box feature costs no
  // summary construction, and the summary filter drops filtered features from
  // the stale serve exactly as the fresh path does.
  const rebuildStale = (bbox: Bbox): PoiSummary[] =>
    staleSummariesWithinBbox(
      cache.values(),
      bbox,
      (cached) => {
        const latLon = cfg.featureLatLon(cached.feature)
        return latLon === null
          ? undefined
          : { latitude: latLon.lat, longitude: latLon.lon }
      },
      (cached) => {
        const summary = cfg.toSummary(cached.layerKey, cached.feature)
        if (summary === null) return null
        return summaryFilter(summary) ? summary : null
      }
    )

  return {
    id: sourceId,
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      lifecycle.signal.throwIfAborted()
      if (shouldSkipOutsideUsWaters(getCurrentPosition, status, sourceId)) {
        return withListProvenance([], 'skipped')
      }
      if (cfg.layers.length === 0) {
        status.recordSkipped(sourceId, cfg.noLayersSkipReason)
        return withListProvenance([], 'skipped')
      }
      const outcome = await fetchListWithOfflineFallback(
        status,
        sourceId,
        `${cfg.sourceLabel} unreachable`,
        () => bboxCache.get(bbox, async (fetchBbox) => {
          const results = await Promise.allSettled(
            cfg.layers.map(async (layerKey) => {
              const features = await cfg.fetchLayerFeatures(
                layerKey, fetchBbox, lifecycle.signal
              )
              return { layerKey, features }
            })
          )
          lifecycle.signal.throwIfAborted()
          const layerFeatures: LayerFeatures<L, F> = []
          let anyLayerOk = false
          let firstRejection: unknown
          for (const result of results) {
            if (result.status === 'rejected') {
              status.recordError(
                sourceId,
                `Layer query failed: ${String(result.reason)}`
              )
              if (firstRejection === undefined) firstRejection = result.reason
              continue
            }
            anyLayerOk = true
            layerFeatures.push(result.value)
          }
          if (!anyLayerOk) {
            throw new Error(
              `Every enabled ${cfg.sourceLabel} layer query failed: ${String(firstRejection)}`
            )
          }
          return layerFeatures
        }, undefined, (layerFeatures) => layerFeatures.length === cfg.layers.length),
        () => rebuildStale(bbox)
      )
      lifecycle.signal.throwIfAborted()
      if (outcome.kind === 'stale') {
        return withListProvenance(outcome.summaries, 'stale')
      }
      const summaries: PoiSummary[] = []
      for (const { layerKey, features } of outcome.value.value) {
        for (const feature of features) {
          const summary = cfg.toSummary(layerKey, feature)
          if (summary === null) continue
          if (!summaryFilter(summary)) continue
          // Reuse the cached wrapper when the feature reference is unchanged
          // (a bbox-debounce hit returns the same features): the store's
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
        const view = cfg.toDetailView(hit)
        if (view !== null) return view
      }
      const parsed = parseSummaryId(id)
      if (parsed === undefined) {
        throw new Error(`Malformed ${cfg.sourceLabel} id "${id}"`)
      }
      if (shouldSkipOutsideUsWaters(getCurrentPosition, status, sourceId)) {
        throw new Error(`No ${cfg.sourceLabel} feature for "${id}"`)
      }
      const feature = await fetchDetailRecorded(status, sourceId,
        () => cfg.fetchFeatureById(parsed.layerKey, parsed.objectId, lifecycle.signal),
        lifecycle.signal)
      if (feature === undefined) {
        throw new Error(`No ${cfg.sourceLabel} feature for "${id}"`)
      }
      const cachedFeature: CachedFeature<L, F> = { layerKey: parsed.layerKey, feature }
      const view = cfg.toDetailView(cachedFeature)
      if (view === null) {
        throw new Error(`${cfg.sourceLabel} feature "${id}" carries no usable geometry`)
      }
      cache.set(id, cachedFeature)
      persist(id, cachedFeature)
      return view
    },
    cacheSize: () => cache.size,
    close: () => {
      lifecycle.abort(new Error(`${cfg.sourceLabel} source closed`))
      closeCache()
      bboxCache.clear()
    }
  }
}
