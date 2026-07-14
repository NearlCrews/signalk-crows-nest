/**
 * OpenSeaMap POI source.
 *
 * Wraps the Overpass client in a `PoiSource`. The bounding-box list query
 * returns full tags, so each listed element is stashed in an in-memory detail
 * cache; `getDetails` is then usually a cache hit and only queries Overpass by
 * id on a miss. This mirrors the ActiveCaptain cache-and-fetch pattern.
 *
 * Every POI the source produces is tagged `source: 'openseamap'` and carries
 * its OpenStreetMap element page as `url`. The ODbL attribution credit
 * required wherever the data is shown rides on `properties.attribution` of
 * the produced note, not inline in the rendered description.
 */

import type { OverpassClient, OverpassElement } from './overpass-client.js'
import { renderOpenSeaMapDetail, readFamilyTags, readLightTags } from './openseamap-detail.js'
import { buildOpenSeaMapSections } from './openseamap-sections.js'
import { elementMarking, seamarkRegex } from './seamark-mapping.js'
import {
  OPENSEAMAP_ATTRIBUTION,
  attachClearance,
  elementName,
  elementOsmUrl,
  toSummary
} from './element-summary.js'
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
import { normalizeSeamarkGroupIds } from '../../shared/seamark-groups.js'
import { OPENSEAMAP_SOURCE_ID } from '../../shared/source-ids.js'
import type { Bbox, PoiDetailView, PoiSummary } from '../../shared/types.js'
import { filterByMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** Dependencies for {@link createOpenSeaMapSource}. */
export interface OpenSeaMapSourceConfig {
  /** The Overpass HTTP client. */
  client: OverpassClient
  /** The seamark groups to fetch, as configured by the user. */
  seamarkGroups: readonly string[]
  /**
   * Hide elements whose OSM `timestamp` year is older than this. `0` (the off
   * sentinel) disables the filter; elements with no timestamp are always
   * included.
   */
  minimumYear: number
  /**
   * Minimum upstream-query interval per bbox, in seconds. A Freeboard
   * refresh burst on the same viewport reuses the cached summaries for
   * this long before re-querying Overpass. `0` (the off sentinel) disables
   * the cache and queries upstream on every list call.
   */
  refreshSeconds: number
  /**
   * Status recorder for per-source detail outcomes. Mirrors the ActiveCaptain
   * source's status wiring so the snapshot reflects OpenSeaMap detail fetches
   * alongside its list fetches.
   */
  status: PluginStatus
  /**
   * Plugin data directory, for the on-disk detail store that survives a
   * restart. Optional so a fixture that does not exercise persistence can omit
   * it; the production input module always supplies it. When absent the source
   * runs in memory only.
   */
  dataDir?: string
}

/** Name of the JSON file the OpenSeaMap detail store persists to. */
const STORE_FILE_NAME = 'openseamap-cache.json'

/** The OSM element types the store guard accepts. */
const OSM_ELEMENT_TYPES: ReadonlySet<string> = new Set(['node', 'way', 'relation'])

/**
 * Narrow an unknown, JSON-parsed value to an {@link OverpassElement}. Checks the
 * fields the summary and detail builders dereference (`type`, `id`, `tags`, and
 * a numeric `position`), so a hydrated entry cannot crash the renderer.
 */
function isOverpassElement (value: unknown): value is OverpassElement {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const element = value as { type?: unknown, id?: unknown, tags?: unknown, position?: unknown }
  if (typeof element.type !== 'string' || !OSM_ELEMENT_TYPES.has(element.type)) {
    return false
  }
  if (typeof element.id !== 'number' || typeof element.tags !== 'object' || element.tags === null) {
    return false
  }
  const position = element.position as { latitude?: unknown, longitude?: unknown } | null
  if (typeof position !== 'object' || position === null) {
    return false
  }
  return typeof position.latitude === 'number' && typeof position.longitude === 'number'
}

/**
 * Translate a registry-side id (`node_123`) back to the slash form
 * (`node/123`) the Overpass client's `getById` parses. A raw OSM numeric id
 * never contains an underscore, so splitting on the FIRST underscore is exact.
 */
function toOverpassTypedId (id: string): string {
  const split = splitOnFirstUnderscore(id)
  return split === null ? id : `${split.prefix}/${split.remainder}`
}

/** Build the source-agnostic detail view for an element. */
function toDetailView (element: OverpassElement): PoiDetailView {
  const { type, skIcon } = elementMarking(element.tags)
  // Read the family and light tags once and hand them to both the HTML renderer
  // and the section builder, rather than each re-reading them off the element.
  const family = readFamilyTags(element.tags)
  const light = readLightTags(element.tags)
  const view: PoiDetailView = {
    name: elementName(element, type),
    position: { ...element.position },
    type,
    url: elementOsmUrl(element),
    source: OPENSEAMAP_SOURCE_ID,
    attribution: OPENSEAMAP_ATTRIBUTION,
    description: renderOpenSeaMapDetail(element, family, light),
    // Normalized detail alongside the HTML: a structured client renders these
    // sections natively, a generic client renders `description`.
    sections: buildOpenSeaMapSections(element, family, light),
    skIcon
  }
  if (element.timestamp !== undefined) view.timestamp = element.timestamp
  if (type === 'Bridge') attachClearance(view, element.tags)
  return view
}

/** Create the OpenSeaMap POI source. */
export function createOpenSeaMapSource (config: OpenSeaMapSourceConfig): PoiSource {
  const { client, seamarkGroups, minimumYear, refreshSeconds, status, dataDir } = config
  const lifecycle = new AbortController()

  // The seamark filter is fixed for the life of the source: the configured
  // groups do not change without a plugin restart. Normalize again at this
  // boundary so a direct caller or hand-edited config cannot turn unknown ids
  // into a pointless, apparently successful empty query.
  const enabledGroups = normalizeSeamarkGroupIds(seamarkGroups)
  const regex = seamarkRegex(enabledGroups)
  const includeMarinas = enabledGroups.includes('harbours')

  // Detail cache, populated from every list query and hydrated from the
  // on-disk store so a cold start offline still renders previously fetched
  // elements. `getDetails` queries Overpass by id only on a miss.
  const { cache, persist, close: closeCache } = createHydratedDetailCache<OverpassElement>({
    dataDir,
    fileName: STORE_FILE_NAME,
    isValue: isOverpassElement
  })
  // Per-bbox debounce: a Freeboard refresh burst on the same view reuses
  // the raw Overpass elements for `refreshSeconds` before re-querying. The
  // cache holds raw elements (not summaries) so the per-call tagging,
  // detail-LRU repopulation, and year filter run outside the cache.
  const bboxCache = createBboxDebounceCache<OverpassElement[]>(
    refreshSeconds,
    MAX_BBOX_CACHE_ENTRIES,
    {
      onRevalidationError: (error) => {
        if (!lifecycle.signal.aborted) {
          status.recordError(
            OPENSEAMAP_SOURCE_ID,
            `Background Overpass list refresh failed: ${String(error)}`
          )
        }
      }
    }
  )

  return {
    id: OPENSEAMAP_SOURCE_ID,
    // The `PoiSource.listPointsOfInterest` contract takes a comma-separated
    // `poiTypes` filter, but OpenSeaMap filters by configured seamark groups
    // instead: the Overpass query is built from `regex`, which the source
    // closes over. The `poiTypes` argument is therefore intentionally ignored
    // for this source.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      lifecycle.signal.throwIfAborted()
      if (enabledGroups.length === 0) {
        status.recordSkipped(OPENSEAMAP_SOURCE_ID, 'no feature groups enabled')
        return withListProvenance([], 'skipped')
      }
      // Cache only the raw Overpass elements. The per-call tagging, the
      // detail-LRU repopulation, and the year filter run OUTSIDE the cache
      // so a runtime config change to `minimumYear` takes effect on the
      // next list call rather than after the TTL, and so a click on a
      // marker whose detail entry has been LRU-evicted between two list
      // calls re-seeds rather than re-fetching upstream.
      const outcome = await fetchListWithOfflineFallback(
        status,
        OPENSEAMAP_SOURCE_ID,
        'Overpass unreachable',
        () => bboxCache.get(bbox, (fetchBbox) =>
          client.listPointsOfInterest(
            fetchBbox,
            regex,
            includeMarinas,
            lifecycle.signal
          )),
        () => filterByMinimumYear(
          staleSummariesWithinBbox(cache.values(), bbox,
            (element) => element.position, toSummary),
          minimumYear)
      )
      lifecycle.signal.throwIfAborted()
      if (outcome.kind === 'stale') {
        return withListProvenance(outcome.summaries, 'stale')
      }
      const summaries: PoiSummary[] = []
      for (const element of outcome.value.value) {
        const summary = toSummary(element)
        cache.set(summary.id, element)
        persist(summary.id, element)
        summaries.push(summary)
      }
      // Year filter is applied source-side so the rest of the pipeline
      // (dedupe, notes output, alarms) never sees filtered elements.
      return withListProvenance(
        filterByMinimumYear(summaries, minimumYear),
        outcome.value.provenance
      )
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      lifecycle.signal.throwIfAborted()
      // A cache hit makes no upstream call, so it is not evidence of Overpass
      // reachability: serve it without recording a success (mirrors the NOAA
      // ENC source). Only the real getById below updates the status row.
      const hit = cache.get(id)
      if (hit !== undefined) {
        return toDetailView(hit)
      }
      // On a miss the Overpass client is queried with the slash form it
      // parses (the cache key is the registry-side underscore id). The
      // shared wrapper owns the miss-vs-outage policy: an absent element
      // (deleted upstream, or a stale id after an LRU eviction) is a normal
      // answer, so the not-found throw below cannot flip the status row to
      // unreachable.
      const element = await fetchDetailRecorded(status, OPENSEAMAP_SOURCE_ID,
        () => client.getById(toOverpassTypedId(id), lifecycle.signal),
        lifecycle.signal)
      if (element === undefined) {
        throw new Error(`No OpenSeaMap element found for "${id}"`)
      }
      cache.set(id, element)
      persist(id, element)
      return toDetailView(element)
    },
    cacheSize: () => cache.size,
    close: () => {
      lifecycle.abort(new Error('OpenSeaMap source closed'))
      // Flush any debounced write so a clean shutdown persists every element
      // fetched during the run, then drop the in-memory detail LRU so a
      // per-config-change restart does not carry a stopped run's entries,
      // matching the NOAA ENC source. The on-disk store is left in place so a
      // later cold start can hydrate it.
      closeCache()
      bboxCache.clear()
      client.close()
    }
  }
}
