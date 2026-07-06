/**
 * CO-OPS station to PoiType, skIcon, label, id, and station-page URL mapping.
 *
 * A tide or current station is a fixed navigational reference point, so its
 * PoiType is `Navigational` and its Freeboard glyph is `navigation-structure`,
 * matching the convention the OpenSeaMap and USCG Light List sources use for
 * every navigational feature. Freeboard registers a fixed set of `sk-` icons
 * and has no dedicated tide or current glyph, so both station families share
 * the registered `navigation-structure` icon rather than risk an unregistered
 * name that would fall back to a yellow square.
 */

import type { CoopsStationRecord, CoopsStationType } from './noaa-coops-types.js'
import type { PoiType } from '../../shared/types.js'
import { safeLinkUrl } from '../../shared/url-safety.js'

/** The PoiType for every CO-OPS station. */
export const COOPS_POI_TYPE: PoiType = 'Navigational'

/** The Freeboard skIcon glyph for every CO-OPS station. */
export const COOPS_SK_ICON = 'navigation-structure'

/** Plain-English label for a station type. */
export function stationTypeLabel (stationType: CoopsStationType): string {
  return stationType === 'tide' ? 'Tide station' : 'Current station'
}

/**
 * The within-source resource id for a station: `<stationType>_<rawId>`. The
 * type prefix keeps a numeric tide id and an alphanumeric current id from ever
 * colliding, and the underscore form matches the NOAA ENC and OpenSeaMap
 * convention (a raw id carries no underscore, so the split back to the two
 * halves is exact). No id form used here contains a slash, so the SignalK
 * resource path `/resources/notes/<id>` is never split.
 */
export function coopsInternalId (record: Pick<CoopsStationRecord, 'stationType' | 'id'>): string {
  return `${record.stationType}_${record.id}`
}

/**
 * The canonical tidesandcurrents.noaa.gov station page, or undefined when the
 * built URL is somehow unsafe. Tide stations resolve to their station home
 * page; current stations resolve to their current-predictions page. The raw id
 * is percent-encoded before interpolation, and the result is routed through
 * {@link safeLinkUrl} so the HTML anchor and the structured `link` item cannot
 * ship a scheme a browser would execute.
 */
export function stationPageUrl (record: CoopsStationRecord): string | undefined {
  const id = encodeURIComponent(record.id)
  const url = record.stationType === 'tide'
    ? `https://tidesandcurrents.noaa.gov/stationhome.html?id=${id}`
    : `https://tidesandcurrents.noaa.gov/noaacurrents/Predictions?id=${id}`
  return safeLinkUrl(url)
}
