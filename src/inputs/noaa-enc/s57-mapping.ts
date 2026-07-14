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
import { finiteOrUndefined, toFiniteNumber } from '../../shared/numbers.js'
import { presentString } from '../../shared/strings.js'

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

/** Strict decimal spellings used by the S-57 code and date readers. */
const S57_CODE_TEXT = /^\d+$/
const SORDAT_TEXT = /^\d{6}(?:\d{2})?$/

/** Calendar months with 30 days. */
const THIRTY_DAY_MONTHS: ReadonlySet<number> = new Set([4, 6, 9, 11])

/**
 * Parse an S-57 code to its number. Accepts the wire shapes the ENC Direct
 * service produces: a JSON number, a single-digit JSON string, `null`,
 * `undefined`, or a blank string. Returns `undefined` for anything other than
 * a non-negative integer or its plain-decimal spelling. Exported so a caller
 * that reads one raw code
 * for several derivations (e.g. QUASOU for both the depth label and the
 * position-quality lookup) can parse it once and pass the number on.
 */
export function parseS57Code (raw: unknown): number | undefined {
  const numeric = toFiniteNumber(raw)
  if (numeric !== null) {
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!S57_CODE_TEXT.test(trimmed)) {
      return undefined
    }
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * Look up an already-parsed S-57 code in `table`. Returns `undefined` for an
 * absent code or one the table does not index. A caller that parses a raw code
 * once (via {@link parseS57Code}) and derives several values from it uses this
 * rather than re-parsing through {@link lookupCode}.
 */
export function lookupParsedCode (
  table: Readonly<Record<number, string>>,
  code: number | undefined
): string | undefined {
  return code !== undefined ? table[code] : undefined
}

/**
 * Look up a numeric S-57 code in `table`. Accepts the wire shapes the ENC
 * Direct service produces (see {@link parseS57Code}). Returns `undefined` for
 * any value that does not parse to an integer the table indexes.
 */
export function lookupCode (
  table: Readonly<Record<number, string>>,
  raw: unknown
): string | undefined {
  return lookupParsedCode(table, parseS57Code(raw))
}

/**
 * QUASOU codes that report the LEAST depth over a feature rather than a plain
 * charted depth: 6 (least depth known) and 7 (least depth unknown but safe to
 * the depth shown). For a wreck, rock, or obstruction this is the
 * safety-critical reading, so the depth label calls it out.
 */
const LEAST_DEPTH_QUASOU_CODES: ReadonlySet<number> = new Set([6, 7])

/**
 * Depth label for an ENC sounding, from an already-parsed QUASOU code. The
 * value is referenced to chart datum, which on US ENCs is Mean Lower Low Water,
 * so the label states MLLW. When QUASOU marks a least-depth sounding (codes 6
 * and 7) the safety-critical fact is the LEAST depth over the feature, so the
 * label says so; otherwise it is the charted depth. Shared by the HTML renderer
 * and the section builder so the two cannot drift.
 */
export function encDepthLabel (quasouCode: number | undefined): string {
  const leastDepth = quasouCode !== undefined && LEAST_DEPTH_QUASOU_CODES.has(quasouCode)
  return leastDepth ? 'Least depth (MLLW)' : 'Charted depth (MLLW)'
}

/**
 * Matches the "non-dangerous" status word with either the hyphen or the space
 * the wire uses. The space form is load-bearing: the substring "dangerous"
 * inside "non dangerous" would otherwise misclassify a space-formatted value as
 * dangerous.
 */
const NON_DANGEROUS_PATTERN = /non[- ]dangerous/

/**
 * Classify a decoded CATWRK/CATOBS category string as dangerous or not. The
 * wire decodes these to strings such as `"dangerous wreck"` or
 * `"non-dangerous wreck"` (the hyphen is sometimes a space). Returns `true` for
 * a dangerous status, `false` for a non-dangerous one, and `undefined` when the
 * category carries no explicit danger word (a descriptive value such as
 * `"foul ground"` or `"wreck showing mast"`, or an absent category).
 */
export function classifyDangerous (category: string | undefined): boolean | undefined {
  if (category === undefined) {
    return undefined
  }
  const lower = category.toLowerCase()
  if (!lower.includes('dangerous')) {
    return undefined
  }
  return !NON_DANGEROUS_PATTERN.test(lower)
}

/**
 * Humanize a pre-decoded S-57 category string (CATWRK or CATOBS). The values
 * arrive already in human-readable lowercase form, e.g. `"dangerous wreck"`,
 * so the only normalization is trimming surrounding whitespace and treating a
 * blank or non-string value as absent. Returns `undefined` when the input
 * carries no useful category label. The detail renderer also reuses this as
 * its general non-empty free-text reader for OBJNAM, INFORM, and DSNM, which
 * need the same trim-and-reject-blank handling.
 */
export const humanizeCategory = presentString

/**
 * Resolve the humanized category label for a hazard feature: CATWRK for a
 * wreck, CATOBS for an obstruction, none for a rock. Shared by the HTML
 * renderer and the section builder so the two cannot drift.
 */
export function categoryLabel (
  layerKey: EncLayerKey,
  properties: Record<string, unknown>
): string | undefined {
  if (layerKey === 'wreck') return humanizeCategory(properties.CATWRK)
  if (layerKey === 'obstruction') return humanizeCategory(properties.CATOBS)
  return undefined
}

/** Read a finite numeric property, treating null and non-numbers as absent. */
export const readNumber = finiteOrUndefined

/**
 * Layer-derived fallback label for a feature, used as the popup header and the
 * list name when a hazard feature carries no OBJNAM. Shared by the source's
 * `featureName` and the detail renderer so the two cannot drift.
 */
export const LAYER_LABEL: Readonly<Record<EncLayerKey, string>> = {
  wreck: 'Wreck',
  obstruction: 'Obstruction',
  rock: 'Rock'
}

/**
 * Every ENC hazard layer (wreck, obstruction, rock) shares one `PoiType` and
 * one Freeboard glyph: the layer does not vary either, so these are plain
 * constants rather than per-layer lookups.
 */
export const LAYER_POI_TYPE: PoiType = 'Hazard'
export const LAYER_SK_ICON = 'hazard'

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
function parseSordat (raw: unknown): { year: number, month: number, day?: number } | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!SORDAT_TEXT.test(trimmed)) return undefined
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
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = month === 2
    ? (leapYear ? 29 : 28)
    : (THIRTY_DAY_MONTHS.has(month) ? 30 : 31)
  if (!Number.isFinite(day) || day < 1 || day > daysInMonth) return undefined
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
  // setUTCFullYear preserves years 0000 through 0099. Date.UTC treats them as
  // 1900 through 1999 for historical compatibility.
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(parts.year, parts.month - 1, day)
  return date.toISOString()
}
