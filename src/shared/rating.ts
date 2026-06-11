/**
 * Minimum-rating bounds and clamp shared between the ActiveCaptain input
 * module and the panel's normalize-config.
 *
 * Mirrors the pattern `year-filter.ts` and `bbox-debounce.ts` already use:
 * the bounds, the default, and the clamp live in one module so the node-side
 * config resolution and the browser-side panel coercion cannot drift. The
 * ActiveCaptain rating filter (`rating-filter.ts`) is the only consumer of the
 * resulting value, since ActiveCaptain is the only source that carries a
 * review score.
 */

import { clampNumber } from './numbers.js'
import { boundedNumberSchema } from './config-schema.js'

/** Lowest minimum rating: 0 disables the rating filter and shows every point. */
export const MIN_RATING = 0

/** Highest minimum rating the ActiveCaptain review scale awards. */
export const MAX_RATING = 5

/** Default minimum rating: the off sentinel, which lists every point. */
export const DEFAULT_MINIMUM_RATING = MIN_RATING

/**
 * Clamp a raw minimum-rating value to `[MIN_RATING, MAX_RATING]`. A
 * non-numeric or non-finite value falls back to {@link DEFAULT_MINIMUM_RATING}.
 * Ratings are fractional (the API averages reviews), so the value is not
 * truncated. A value at or below {@link MIN_RATING} is the "show everything"
 * case the rating filter treats as off.
 */
export function clampMinimumRating (raw: unknown): number {
  return clampNumber(raw, MIN_RATING, MAX_RATING, DEFAULT_MINIMUM_RATING)
}

/**
 * Config-schema fragment for the minimum-rating filter field, colocated with
 * the bounds it carries, matching the `minimumYearSchema` and
 * `refreshSecondsSchema` siblings.
 */
export function minimumRatingSchema (title: string): Record<string, unknown> {
  return boundedNumberSchema(title, DEFAULT_MINIMUM_RATING, MIN_RATING, MAX_RATING)
}
