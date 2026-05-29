/**
 * Render an ISO-8601 timestamp as a localized, relative phrase such as
 * "5 minutes ago". Extracted from `StatusBar.tsx` as a plain-TypeScript module
 * so the unit-stepping logic is testable without an `.tsx` import.
 */

import { formatRelativeDelta, type RelativeUnit } from '../shared/relative-time-format.js'

/** Relative-time units, largest first, paired with their length in seconds. */
const RELATIVE_UNITS: ReadonlyArray<RelativeUnit> = [
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1]
]

/**
 * Shared `RelativeTimeFormat` instance. Construction is non-trivial and the
 * formatter is reentrant, so it is reused across every call rather than rebuilt
 * per call (StatusBar renders multiple rows on each 5-second status poll).
 */
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** Render an ISO-8601 timestamp as a localized, relative phrase. */
export function relativeTime (iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso

  const deltaSeconds = Math.round((then - Date.now()) / 1000)
  return formatRelativeDelta(deltaSeconds, RELATIVE_UNITS, RELATIVE_TIME_FORMAT)
}
