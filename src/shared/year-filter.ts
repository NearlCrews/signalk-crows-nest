/**
 * Year filter for source-tagged points of interest, plus the shared bounds
 * and clamp every opting-in input module uses to normalize its raw config
 * value.
 *
 * Each opting-in source populates `PoiSummary.timestamp` from its own wire
 * date (NOAA ENC `SORDAT`, USCG `MODIFIED_DATE`, OSM element `timestamp`,
 * etc.); `filterByMinimumYear` then drops entries whose ISO-8601 timestamp
 * parses to a year strictly older than the configured minimum. The contract
 * mirrors the existing rating filter in
 * `src/inputs/active-captain/rating-filter.ts`:
 *
 * - `0` (the off sentinel) returns the input unchanged. Existing installs
 *   that have not set the field see no behavior change.
 * - A POI with no `timestamp` is always included. The filter only narrows;
 *   a source whose wire data carries no date never disappears from the chart.
 * - An unparseable `timestamp` is treated as absent (included). A malformed
 *   string should never silently drop data on a behalf the wire did not
 *   authorize.
 */

import type { PoiSummary } from './types.js'

/** Off-sentinel and lower bound for every per-source minimum-year filter. */
export const MIN_YEAR = 0

/**
 * Upper bound on every minimum-year filter. Generous (a far-future year) so a
 * user who wants to cap by a future-year threshold is not blocked by clamp
 * logic.
 */
export const MAX_YEAR = 9999

/** Default minimum year on every per-source filter (the off sentinel). */
export const DEFAULT_MINIMUM_YEAR = MIN_YEAR

/**
 * Clamp a raw minimum-year value to `[MIN_YEAR, MAX_YEAR]` and truncate to an
 * integer. A non-numeric or non-finite value falls back to the off default.
 * The four call sites (three input modules, plus the panel's
 * normalize-config) all route their per-source year through this helper so
 * the bounds and the fallback rule live in one place.
 */
export function clampMinimumYear (raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MINIMUM_YEAR
  if (raw < MIN_YEAR) return MIN_YEAR
  if (raw > MAX_YEAR) return MAX_YEAR
  return Math.trunc(raw)
}

/**
 * Drop every POI whose `timestamp` year is strictly less than
 * `minimumYear`. Pure function. The input itself is returned by reference
 * when the filter is off (`minimumYear` is 0 or non-positive), so the common
 * case allocates nothing; the array is treated as read-only either way.
 * Matches the `PoiSummary[]` return shape of `filterByRating` so the
 * source-side filter call sites compose without a cast.
 */
export function filterByMinimumYear (
  pois: PoiSummary[],
  minimumYear: number
): PoiSummary[] {
  if (!Number.isFinite(minimumYear) || minimumYear <= 0) {
    return pois
  }
  return pois.filter((poi) => isOnOrAfter(poi.timestamp, minimumYear))
}

/**
 * True when `timestamp` represents a year greater than or equal to
 * `minimumYear`. Undefined and unparseable timestamps return true so the
 * filter never drops a POI on absent or malformed wire data.
 *
 * Fast path: every source produces ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`) whose
 * first four characters are the year, so the common case is a single slice
 * plus a parseInt rather than constructing a Date object per POI. The slow
 * path handles any other parseable form via `Date.parse`.
 */
function isOnOrAfter (timestamp: string | undefined, minimumYear: number): boolean {
  if (timestamp === undefined || timestamp.length < 4) return true
  const fastYear = Number.parseInt(timestamp.slice(0, 4), 10)
  if (Number.isFinite(fastYear) && timestamp.charCodeAt(4) === HYPHEN_CODE) {
    return fastYear >= minimumYear
  }
  const parsedMs = Date.parse(timestamp)
  if (!Number.isFinite(parsedMs)) return true
  return new Date(parsedMs).getUTCFullYear() >= minimumYear
}

/** Character code for `-`, used by the ISO fast path in {@link isOnOrAfter}. */
const HYPHEN_CODE = 0x2d
