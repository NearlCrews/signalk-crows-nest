/**
 * Shared time constants.
 *
 * Every duration the plugin expresses in milliseconds or seconds, plus the
 * multiples a source's TTL configuration converts through. Centralizing the
 * literals means a maintainer who reads a `5 * MS_PER_MINUTE` expression sees
 * what the number is without reverse-engineering `300000`, and the relative-time
 * formatters share one `SECONDS_PER_*` family rather than each redefining 60,
 * 3600, and 86400.
 */

/** Number of milliseconds in one second. */
export const MS_PER_SECOND = 1000

/** Number of milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000

/** Number of milliseconds in one hour. */
export const MS_PER_HOUR = MS_PER_MINUTE * 60

/** Number of seconds in one minute. */
export const SECONDS_PER_MINUTE = 60

/** Number of seconds in one hour. */
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * 60

/** Number of seconds in one day. */
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * 24

/** Number of minutes in one hour. */
export const MINUTES_PER_HOUR = 60

/** Number of minutes in one day. */
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * 24
