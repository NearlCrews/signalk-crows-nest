/**
 * OpenSeaMap POI source.
 *
 * Wraps the Overpass client in a `PoiSource`. The bounding-box list query
 * returns full tags, so each listed element is stashed in an in-memory detail
 * cache; `getDetails` is then usually a cache hit and only queries Overpass by
 * id on a miss. This mirrors the ActiveCaptain cache-and-fetch pattern.
 *
 * Every POI the source produces is tagged `source: 'openseamap'`, carries its
 * OpenStreetMap element page as `url`, and renders its detail with the ODbL
 * attribution footer: the Open Database License requires attribution wherever
 * the data is shown.
 */

import { LRUCache } from 'lru-cache'
import type { OverpassClient, OverpassElement } from './overpass-client.js'
import { renderOpenSeaMapDetail } from './openseamap-detail.js'
import { elementPoiType, elementSkIcon, seamarkRegex } from './seamark-mapping.js'
import type { PoiSource } from '../poi-source.js'
import { appendAttribution } from '../../shared/attribution.js'
import { MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import type { Bbox, PoiDetailView, PoiSummary, PoiType } from '../../shared/types.js'
import { filterByMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** The stable id of the OpenSeaMap source. */
export const OPENSEAMAP_SOURCE_ID = 'openseamap'

/**
 * Attribution credit for OpenStreetMap data. The Open Database License (ODbL)
 * requires this to be visible wherever the data is shown, so it is rendered
 * into every detail description, not just the README.
 */
export const OPENSEAMAP_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'

/** Prefix of an OpenStreetMap element page, completed with `type/id`. */
const OSM_ELEMENT_URL_PREFIX = 'https://www.openstreetmap.org/'

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
   * Status recorder for per-source detail outcomes. Mirrors the ActiveCaptain
   * source's status wiring so the snapshot reflects OpenSeaMap detail fetches
   * alongside its list fetches.
   */
  status: PluginStatus
}

/**
 * Internal id for an element, e.g. `node_123`. The slash form (`node/123`)
 * cannot be used: SignalK serves resources at `/resources/notes/<id>`, so a
 * `/` inside the id silently splits the path and the resource 404s. The
 * underscore is URL-safe and the alarm path sanitizer already accepts it.
 */
function elementId (element: OverpassElement): string {
  return `${element.type}_${element.id}`
}

/** OSM element page URL, built from the original slash form OSM expects. */
function elementOsmUrl (element: OverpassElement): string {
  return `${OSM_ELEMENT_URL_PREFIX}${element.type}/${element.id}`
}

/**
 * Translate a registry-side id (`node_123`) back to the slash form
 * (`node/123`) the Overpass client's `getById` parses. A raw OSM numeric id
 * never contains an underscore, so splitting on the FIRST underscore is exact.
 */
function toOverpassTypedId (id: string): string {
  const underscore = id.indexOf('_')
  if (underscore <= 0) {
    return id
  }
  return `${id.slice(0, underscore)}/${id.slice(underscore + 1)}`
}

/** A display name for an element: its `name` tag, or a type-derived fallback. */
function elementName (element: OverpassElement, type: PoiType): string {
  return element.tags.name ?? element.tags['seamark:name'] ?? `Unnamed ${type.toLowerCase()}`
}

/** Build the source-agnostic detail view for an element. */
function toDetailView (element: OverpassElement): PoiDetailView {
  const type = elementPoiType(element.tags)
  const view: PoiDetailView = {
    name: elementName(element, type),
    position: { ...element.position },
    type,
    url: elementOsmUrl(element),
    source: OPENSEAMAP_SOURCE_ID,
    attribution: OPENSEAMAP_ATTRIBUTION,
    description: appendAttribution(renderOpenSeaMapDetail(element), OPENSEAMAP_ATTRIBUTION),
    skIcon: elementSkIcon(element.tags)
  }
  if (element.timestamp !== undefined) view.timestamp = element.timestamp
  return view
}

/** Build the list summary for an element. */
function toSummary (element: OverpassElement): PoiSummary {
  const type = elementPoiType(element.tags)
  const summary: PoiSummary = {
    id: elementId(element),
    type,
    position: { ...element.position },
    name: elementName(element, type),
    source: OPENSEAMAP_SOURCE_ID,
    url: elementOsmUrl(element),
    attribution: OPENSEAMAP_ATTRIBUTION,
    skIcon: elementSkIcon(element.tags)
  }
  if (element.timestamp !== undefined) summary.timestamp = element.timestamp
  return summary
}

/** Create the OpenSeaMap POI source. */
export function createOpenSeaMapSource (config: OpenSeaMapSourceConfig): PoiSource {
  const { client, seamarkGroups, minimumYear, status } = config

  // The seamark filter is fixed for the life of the source: the configured
  // groups do not change without a plugin restart.
  const regex = seamarkRegex(seamarkGroups)

  // Detail cache, populated from every list query. `getDetails` queries
  // Overpass by id only on a miss.
  const cache = new LRUCache<string, OverpassElement>({ max: MAX_POI_CACHE_ENTRIES })

  return {
    id: OPENSEAMAP_SOURCE_ID,
    // The `PoiSource.listPointsOfInterest` contract takes a comma-separated
    // `poiTypes` filter, but OpenSeaMap filters by configured seamark groups
    // instead: the Overpass query is built from `regex`, which the source
    // closes over. The `poiTypes` argument is therefore intentionally ignored
    // for this source.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      const elements = await client.listPointsOfInterest(bbox, regex)
      const summaries = elements.map((element) => {
        cache.set(elementId(element), element)
        return toSummary(element)
      })
      // Year filter is applied source-side so the rest of the pipeline
      // (dedupe, notes output, alarms) never sees filtered elements.
      return filterByMinimumYear(summaries, minimumYear)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      try {
        // The cache key matches the registry-side underscore id; on a miss the
        // Overpass client is queried with the slash form it parses.
        const element = cache.get(id) ?? await client.getById(toOverpassTypedId(id))
        if (element === undefined) {
          throw new Error(`No OpenSeaMap element found for "${id}"`)
        }
        cache.set(id, element)
        const view = toDetailView(element)
        status.recordDetailSuccess(OPENSEAMAP_SOURCE_ID)
        return view
      } catch (error) {
        status.recordError(
          OPENSEAMAP_SOURCE_ID, `Detail request failed: ${String(error)}`)
        throw error
      }
    },
    cacheSize: () => cache.size,
    close: () => { client.close() }
  }
}
