/**
 * Wire types for the NOAA ENC Direct ArcGIS REST MapServer.
 *
 * The server returns standard GeoJSON when `f=geojson` is set, plus an
 * `exceededTransferLimit` flag the ENC Direct HTTP client uses to drive
 * pagination. The numeric ArcGIS layer ids differ per scale band, so the
 * `LAYER_IDS_BY_BAND` table is the single source of truth for every
 * `(band, layerKey)` to layer-id resolution downstream of this module.
 */

// The ScaleBand type is owned by src/shared/scale-band.ts (browser-safe so the
// panel can read the band list too). Imported for use within this module and
// re-exported so this input's existing importers keep their
// `./enc-direct-types.js` path.
import type { ScaleBand } from '../../shared/scale-band.js'
export type { ScaleBand }

/** The three S-57 point hazard layers the plugin reads. */
export type EncLayerKey = 'wreck' | 'obstruction' | 'rock'

/** Numeric ArcGIS layer ids per scale band, for each hazard layer. */
export interface LayerIds {
  readonly wreck: number
  readonly obstruction: number
  readonly rock: number
}

/**
 * One ENC Direct GeoJSON feature as returned by the MapServer.
 *
 * The `properties` bag carries raw S-57 attributes. Observed wire shapes from
 * a live coastal-band wreck query (3 features) that the S-57 mapping needs to
 * handle:
 *
 *  - `CATWRK` is a DECODED STRING already, e.g. `"dangerous wreck"`, not a
 *    numeric S-57 enum code. A `Record<number, string>` lookup table on this
 *    field would be unused; the mapper should pass the string through with a
 *    capitalize or humanize step.
 *  - `QUASOU` is a stringified single digit, e.g. `"6"`. Numeric parse before
 *    table lookup.
 *  - `WATLEV` is a NUMBER (the S-57 enum code, e.g. `3`). Direct lookup.
 *  - `SORDAT` length varies: both `"YYYYMM"` (6 chars) and `"YYYYMMDD"` (8
 *    chars) appear. A date formatter must branch on length so the day is not
 *    silently dropped when present.
 *  - `OBJNAM` is frequently `null`. The detail-view title needs the
 *    layer-label fallback.
 *  - Many fields ship as `null` on most features: `CONRAD`, `CONVIS`,
 *    `EXPSOU`, `HEIGHT`, `SOUACC`, `TECSOU`, `VERACC`, `VERDAT`, `VERLEN`,
 *    `INFORM`, `SCAMIN`. The renderer must skip null fields, not write the
 *    word "null".
 */
export interface EncFeature {
  type: 'Feature'
  id?: number
  geometry: { type: 'Point', coordinates: [number, number] }
  properties: Record<string, unknown>
}

/**
 * Numeric ArcGIS layer ids per scale band. Discovered live from the ENC Direct
 * MapServer endpoints; every entry was cross-checked against
 * `MapServer/<id>?f=json` so the id matches the layer name. A `test/enc-layer-ids.test.ts` guard asserts no zero placeholders
 * survive so a contributor cannot silently ship a default-zero entry.
 */
export const LAYER_IDS_BY_BAND: Readonly<Record<ScaleBand, LayerIds>> = {
  overview: { wreck: 24, obstruction: 21, rock: 22 },
  general: { wreck: 29, obstruction: 26, rock: 27 },
  coastal: { wreck: 33, obstruction: 30, rock: 31 },
  approach: { wreck: 39, obstruction: 36, rock: 37 },
  harbour: { wreck: 36, obstruction: 33, rock: 34 },
  berthing: { wreck: 21, obstruction: 19, rock: 20 }
}
