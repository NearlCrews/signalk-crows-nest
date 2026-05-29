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
import { toFiniteNumber } from '../../shared/numbers.js'

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
  const numeric = toFiniteNumber(raw)
  if (numeric !== null) {
    return table[numeric]
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

/**
 * Parse the S-57 `SORDAT` source-date field into its `(year, month, day)`
 * triple. The wire ships both six-character `YYYYMM` and eight-character
 * `YYYYMMDD` forms; the renderer needs the original precision (so the popup
 * does not invent a day), but the year-filter helper needs only the year,
 * so both consumers route through this parser.
 *
 * `day` is left undefined for the six-character form. Anything else (null,
 * non-string, wrong length, non-numeric digits) returns `undefined`.
 */
export function parseSordat (raw: unknown): { year: number, month: number, day?: number } | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed.length !== 6 && trimmed.length !== 8) return undefined
  const year = Number.parseInt(trimmed.slice(0, 4), 10)
  const month = Number.parseInt(trimmed.slice(4, 6), 10)
  // Reject out-of-range months and days so Date.UTC does not silently wrap
  // a `month=13` into the next January or a `day=99` three months forward;
  // a popup-rendered "2024-02-99" and a published timestamp of
  // "2024-04-08T00:00:00.000Z" for the same wire value would disagree.
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return undefined
  }
  if (trimmed.length === 6) return { year, month }
  const day = Number.parseInt(trimmed.slice(6, 8), 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) return undefined
  return { year, month, day }
}

/**
 * Format the parsed SORDAT for the popup, preserving the precision the wire
 * sent. Returns `YYYY-MM` for the six-character form and `YYYY-MM-DD` for
 * the eight-character form, or `undefined` when the input did not parse.
 */
export function formatSordatDisplay (raw: unknown): string | undefined {
  const parts = parseSordat(raw)
  if (parts === undefined) return undefined
  const year = String(parts.year).padStart(4, '0')
  const month = String(parts.month).padStart(2, '0')
  if (parts.day === undefined) return `${year}-${month}`
  const day = String(parts.day).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Convert SORDAT to an ISO-8601 UTC timestamp suitable for
 * {@link PoiSummary.timestamp}. The six-character `YYYYMM` form defaults to
 * the first of the month. Returns `undefined` when the input did not parse.
 */
export function sordatToIsoTimestamp (raw: unknown): string | undefined {
  const parts = parseSordat(raw)
  if (parts === undefined) return undefined
  const day = parts.day ?? 1
  // `Date.UTC` accepts months 0-indexed; SORDAT months are 1-indexed.
  const ms = Date.UTC(parts.year, parts.month - 1, day)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}
