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
import { elementPoiType, seamarkRegex } from './seamark-mapping.js'
import type { PoiSource } from '../poi-source.js'
import { appendAttribution } from '../../shared/attribution.js'
import type { Bbox, PoiDetailView, PoiSummary, PoiType } from '../../shared/types.js'

/** The stable id of the OpenSeaMap source. */
export const OPENSEAMAP_SOURCE_ID = 'openseamap'

/**
 * Attribution credit for OpenStreetMap data. The Open Database License (ODbL)
 * requires this to be visible wherever the data is shown, so it is rendered
 * into every detail description, not just the README.
 */
export const OPENSEAMAP_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'

/** Prefix of an OpenStreetMap element page, completed with the typed id. */
const OSM_ELEMENT_URL_PREFIX = 'https://www.openstreetmap.org/'

/** Hard ceiling on cached detail entries, guarding memory on long sessions. */
const MAX_CACHE_ENTRIES = 5000

/** Dependencies for {@link createOpenSeaMapSource}. */
export interface OpenSeaMapSourceConfig {
  /** The Overpass HTTP client. */
  client: OverpassClient
  /** The seamark groups to fetch, as configured by the user. */
  seamarkGroups: readonly string[]
}

/** The typed OSM id for an element, e.g. `node/123`. */
function typedId (element: OverpassElement): string {
  return `${element.type}/${element.id}`
}

/** A display name for an element: its `name` tag, or a type-derived fallback. */
function elementName (element: OverpassElement, type: PoiType): string {
  return element.tags.name ?? element.tags['seamark:name'] ?? `Unnamed ${type.toLowerCase()}`
}

/** Escape text for safe inclusion in the rendered HTML description. */
function escapeHtml (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render a simple HTML description for an OpenSeaMap element: a one-line
 * identity header followed by a table of its OSM tags. The shared attribution
 * footer is appended by the caller.
 */
function renderDescription (element: OverpassElement): string {
  const rows = Object.entries(element.tags)
    .filter(([key]) => key !== 'name')
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('')
  const table = rows.length > 0 ? `<table class="osm-tags">${rows}</table>` : ''
  return `<p>OpenStreetMap ${escapeHtml(element.type)} ${element.id}</p>${table}`
}

/** Build the source-agnostic detail view for an element. */
function toDetailView (element: OverpassElement): PoiDetailView {
  const id = typedId(element)
  const type = elementPoiType(element.tags)
  return {
    name: elementName(element, type),
    position: { ...element.position },
    type,
    url: `${OSM_ELEMENT_URL_PREFIX}${id}`,
    source: OPENSEAMAP_SOURCE_ID,
    attribution: OPENSEAMAP_ATTRIBUTION,
    description: appendAttribution(renderDescription(element), OPENSEAMAP_ATTRIBUTION)
  }
}

/** Build the list summary for an element. */
function toSummary (element: OverpassElement): PoiSummary {
  const id = typedId(element)
  const type = elementPoiType(element.tags)
  return {
    id,
    type,
    position: { ...element.position },
    name: elementName(element, type),
    source: OPENSEAMAP_SOURCE_ID,
    url: `${OSM_ELEMENT_URL_PREFIX}${id}`,
    attribution: OPENSEAMAP_ATTRIBUTION
  }
}

/** Create the OpenSeaMap POI source. */
export function createOpenSeaMapSource (config: OpenSeaMapSourceConfig): PoiSource {
  const { client, seamarkGroups } = config

  // The seamark filter is fixed for the life of the source: the configured
  // groups do not change without a plugin restart.
  const regex = seamarkRegex(seamarkGroups)

  // Detail cache, populated from every list query. `getDetails` queries
  // Overpass by id only on a miss.
  const cache = new LRUCache<string, OverpassElement>({ max: MAX_CACHE_ENTRIES })

  return {
    id: OPENSEAMAP_SOURCE_ID,
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      const elements = await client.listPointsOfInterest(bbox, regex)
      return elements.map((element) => {
        cache.set(typedId(element), element)
        return toSummary(element)
      })
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const element = cache.get(id) ?? await client.getById(id)
      if (element === undefined) {
        throw new Error(`No OpenSeaMap element found for "${id}"`)
      }
      cache.set(id, element)
      return toDetailView(element)
    },
    cacheSize: () => cache.size,
    close: () => { client.close() }
  }
}
