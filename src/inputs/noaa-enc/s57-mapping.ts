/**
 * S-57 enum to human-label tables for the NOAA ENC Direct detail renderer,
 * plus the per-layer PoiType and Freeboard skIcon mappings every hazard layer
 * shares.
 *
 * The ENC Direct ArcGIS service does NOT publish the raw S-57 codes uniformly:
 * some fields are pre-decoded to strings, others ship as their numeric codes,
 * and a few ship as single-digit JSON strings. The shapes verified live against
 * the wreck (33), obstruction (30), and underwater-rock (31) layers at the
 * coastal scale band are:
 *
 *  - CATWRK and CATOBS arrive as DECODED STRINGS, e.g. `"dangerous wreck"`,
 *    `"foul ground"`, or a blank `" "` when not categorized. The plugin uses
 *    {@link humanizeCategory} to pass them through with whitespace trimmed,
 *    treating blanks and `null` as absent. A numeric lookup table would never
 *    match these fields, so none is provided.
 *  - WATLEV arrives as a JSON NUMBER, e.g. `3` (always submerged). The
 *    {@link WATLEV} table maps each S-57 code to a human label.
 *  - QUASOU arrives as a SINGLE-DIGIT JSON STRING, e.g. `"6"` (least depth
 *    known). The {@link QUASOU} table is indexed by the parsed number.
 *  - TECSOU arrives as a SINGLE-DIGIT JSON STRING, e.g. `"2"` (side-scan
 *    sonar). Frequently `null`. Same shape as QUASOU.
 *
 * {@link lookupCode} accepts a JSON number, a single-digit JSON string, or
 * `null` / `undefined` / a blank string, so every callsite in the renderer
 * routes its raw property value through the same helper rather than
 * branching on type per field.
 */

import type { EncLayerKey } from './enc-direct-types.js'
import type { PoiType } from '../../shared/types.js'

/**
 * IHO S-57 water-level (WATLEV) codes the wire publishes as JSON numbers.
 * The full table is six codes; the seventh ("floating") is rarely emitted at
 * point-feature scale but kept for completeness.
 */
export const WATLEV: Readonly<Record<number, string>> = {
  1: 'partly submerged at high water',
  2: 'always dry',
  3: 'always submerged',
  4: 'covers and uncovers',
  5: 'awash',
  6: 'subject to inundation or flooding',
  7: 'floating'
}

/**
 * IHO S-57 sounding-quality (QUASOU) codes the wire publishes as single-digit
 * JSON strings, e.g. `"6"`.
 */
export const QUASOU: Readonly<Record<number, string>> = {
  1: 'depth known',
  2: 'depth unknown',
  3: 'doubtful sounding',
  4: 'unreliable sounding',
  5: 'no bottom found at value shown',
  6: 'least depth known',
  7: 'least depth unknown but safe to depth shown'
}

/**
 * IHO S-57 sounding-technique (TECSOU) codes the wire publishes as
 * single-digit JSON strings, e.g. `"2"`.
 */
export const TECSOU: Readonly<Record<number, string>> = {
  1: 'found by echo sounder',
  2: 'found by side-scan sonar',
  3: 'found by multi-beam',
  4: 'found by diver',
  5: 'found by lead-line',
  6: 'swept by wire-drag',
  7: 'found by laser',
  8: 'swept by vertical acoustic system',
  9: 'found by electromagnetic sensor',
  10: 'computed',
  11: 'estimated',
  12: 'found by manual sounding',
  13: 'found by satellite imagery',
  14: 'found by levelling'
}

/**
 * Look up a numeric S-57 code in `table`. Accepts the wire shapes the ENC
 * Direct service produces: a JSON number, a single-digit JSON string, `null`,
 * `undefined`, or a blank string. Returns `undefined` for any value that does
 * not parse to an integer the table indexes.
 */
export function lookupCode (
  table: Readonly<Record<number, string>>,
  raw: unknown
): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return table[raw]
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) ? table[parsed] : undefined
  }
  return undefined
}

/**
 * Humanize a pre-decoded S-57 category string (CATWRK or CATOBS). The values
 * arrive already in human-readable lowercase form, e.g. `"dangerous wreck"`,
 * so the only normalization is trimming surrounding whitespace and treating a
 * blank or non-string value as absent. Returns `undefined` when the input
 * carries no useful category label.
 */
export function humanizeCategory (raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Resolve the PoiType for an ENC hazard layer. Always `Hazard`. */
export function layerPoiType (_layer: EncLayerKey): PoiType {
  return 'Hazard'
}

/** Resolve the Freeboard skIcon glyph for an ENC hazard layer. Always `hazard`. */
export function layerSkIcon (_layer: EncLayerKey): string {
  return 'hazard'
}
