/**
 * Parse an HTTP `Retry-After` header into a millisecond delay.
 *
 * Per RFC 9110 the value is either a non-negative count of seconds or an
 * HTTP-date. Only an all-digits value is read as seconds, so a malformed
 * `"12abc"` is not silently accepted as `12`; anything else falls through to the
 * date branch, which yields `undefined` for an unparseable value. Shared by the
 * queued upstream HTTP client(s) for consistent Retry-After parsing.
 */

import { MS_PER_SECOND } from './time.js'

/** A `Retry-After` value of all digits is a seconds count; hoisted for module-scope consistency. */
const SECONDS_ONLY = /^\d+$/

/**
 * Parse a `Retry-After` header value into a delay in milliseconds, or
 * `undefined` when the header is absent, blank, or unparseable.
 */
export function parseRetryAfterMs (header: string | null): number | undefined {
  if (header === null) return undefined
  const trimmed = header.trim()
  if (trimmed === '') return undefined
  if (SECONDS_ONLY.test(trimmed)) return Number.parseInt(trimmed, 10) * MS_PER_SECOND
  const dateMs = Date.parse(trimmed)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined
}
