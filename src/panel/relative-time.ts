/**
 * Render an ISO-8601 timestamp as a localized, relative phrase such as
 * "5 minutes ago". Extracted from `StatusBar.tsx` as a plain-TypeScript module
 * so the unit-stepping logic is testable without an `.tsx` import.
 *
 * The shared UI package ships `formatRelativeAge`, which phrases exactly this
 * kind of age. It is deliberately not used here: the package's export map
 * declares an `import` condition only, so it cannot be loaded from a module
 * the CommonJS `node:test` suite pulls in, and both this module and its
 * `source-status-pill.ts` consumer are covered there. Panel `.tsx` components,
 * which only ever run through webpack, use the shared package freely.
 */

import { formatRelativeDelta, type RelativeUnit } from '../shared/relative-time-format.js'
import { SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from '../shared/time.js'

/** Relative-time units, largest first, paired with their length in seconds. */
const RELATIVE_UNITS: ReadonlyArray<RelativeUnit> = [
  ['day', SECONDS_PER_DAY],
  ['hour', SECONDS_PER_HOUR],
  ['minute', SECONDS_PER_MINUTE],
  ['second', 1]
]

/**
 * Shared `RelativeTimeFormat` instance. Construction is non-trivial and the
 * formatter is reentrant, so it is reused across every call rather than rebuilt
 * per call (StatusBar renders multiple rows on each 5-second status poll).
 */
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/**
 * Render a timestamp (an ISO-8601 string, or epoch milliseconds) as a
 * localized, relative phrase. The epoch-ms form lets a caller that already
 * holds a millisecond clock value skip the ISO round trip. A timestamp that
 * does not resolve to a finite instant is returned verbatim, so a malformed
 * value stays visible rather than formatting as a nonsense age.
 */
export function relativeTime (at: string | number): string {
  const then = typeof at === 'number' ? at : new Date(at).getTime()
  if (!Number.isFinite(then)) return String(at)

  const deltaSeconds = Math.round((then - Date.now()) / 1000)
  return formatRelativeDelta(deltaSeconds, RELATIVE_UNITS, RELATIVE_TIME_FORMAT)
}
