/**
 * Maps a raw Overpass element to a `PoiSummary`.
 *
 * Extracted from `openseamap-source.ts` so the route-draft OpenSeaMap
 * provider can reuse the same mapping without a second copy.
 */

import type { OverpassElement } from './overpass-client.js'
import { elementMarking } from './seamark-mapping.js'
import { parseOsmClearanceMeters } from './clearance.js'
import { tagValue } from './openseamap-detail.js'
import type { PoiSummary, PoiType } from '../../shared/types.js'
import { OPENSEAMAP_SOURCE_ID } from '../../shared/source-ids.js'

/**
 * Attribution credit for OpenStreetMap data. The Open Database License (ODbL)
 * requires this to be visible wherever the data is shown; it is published on
 * every produced note as `properties.attribution` for the SignalK client to
 * render.
 */
export const OPENSEAMAP_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'

/** Prefix of an OpenStreetMap element page, completed with `type/id`. */
const OSM_ELEMENT_URL_PREFIX = 'https://www.openstreetmap.org/'

/**
 * Internal id for an element, e.g. `node_123`. The slash form (`node/123`)
 * cannot be used: SignalK serves resources at `/resources/notes/<id>`, so a
 * `/` inside the id silently splits the path and the resource 404s. The
 * underscore is URL-safe and the alarm path sanitizer already accepts it.
 */
export function elementId (element: OverpassElement): string {
  return `${element.type}_${element.id}`
}

/** OSM element page URL, built from the original slash form OSM expects. */
export function elementOsmUrl (element: OverpassElement): string {
  return `${OSM_ELEMENT_URL_PREFIX}${element.type}/${element.id}`
}

/**
 * A display name for an element: its `name` tag, then `seamark:name`, then a
 * type-derived fallback. Each tag is read through {@link tagValue} so a
 * whitespace-only value is rejected and falls through rather than yielding a
 * blank title, matching the detail renderer's header behaviour.
 */
export function elementName (element: OverpassElement, type: PoiType): string {
  const name = tagValue(element.tags, 'name') ?? tagValue(element.tags, 'seamark:name')
  return name ?? `Unnamed ${type.toLowerCase()}`
}

/**
 * Attach the OSM vertical clearance to a built POI when a clearance tag parses.
 * Called only for Bridge POIs, since the air-draft check reads
 * `verticalClearanceMeters` on bridges alone.
 */
export function attachClearance (
  target: { verticalClearanceMeters?: number },
  tags: Record<string, string>
): void {
  const clearance = parseOsmClearanceMeters(tags)
  if (clearance !== undefined) target.verticalClearanceMeters = clearance
}

/** Build the list summary for an element. */
export function toSummary (element: OverpassElement): PoiSummary {
  const { type, skIcon } = elementMarking(element.tags)
  const summary: PoiSummary = {
    id: elementId(element),
    type,
    position: { ...element.position },
    name: elementName(element, type),
    source: OPENSEAMAP_SOURCE_ID,
    url: elementOsmUrl(element),
    attribution: OPENSEAMAP_ATTRIBUTION,
    skIcon
  }
  if (element.timestamp !== undefined) summary.timestamp = element.timestamp
  if (type === 'Bridge') attachClearance(summary, element.tags)
  return summary
}
