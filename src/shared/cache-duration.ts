/**
 * ActiveCaptain POI-detail cache-duration bounds, clamp, and schema fragment.
 * Browser-safe (the only import is the dependency-free numbers module) so the
 * panel's normalize-config and the ActiveCaptain input module both import the
 * one set of values rather than each keeping a hand-synced copy, mirroring the
 * rating.ts / proximity-radius.ts shared-bounds pattern. Kept separate from
 * cache.ts, which holds the in-memory entry-count ceilings.
 */

import { positiveCappedNumber } from './numbers.js'
import { MINUTES_PER_DAY } from './time.js'
import { boundedNumberSchema } from './config-schema.js'

/**
 * Default ActiveCaptain POI-detail cache duration, in minutes: 24 hours.
 * POI details are nearly static (the volatile part, a new review, is
 * cosmetic; the safety-relevant parts, a bridge height or a hazard position,
 * barely change), and the cache serves stale details when a refetch fails,
 * so the TTL governs upstream traffic, not data availability.
 */
export const DEFAULT_CACHE_DURATION_MINUTES = MINUTES_PER_DAY

/**
 * Upper bound on the cache duration: 31 days. Generous (POI details change
 * slowly), but it keeps a hand-edited config from pinning details forever.
 */
export const MAX_CACHE_DURATION_MINUTES = 31 * MINUTES_PER_DAY

/**
 * Resolve a raw cache-duration config value: a non-positive or non-numeric
 * value falls back to {@link DEFAULT_CACHE_DURATION_MINUTES}, and the result
 * is capped at {@link MAX_CACHE_DURATION_MINUTES}. Shared by the ActiveCaptain
 * input and the panel's normalize-config so the two cannot drift.
 */
export function clampCacheDurationMinutes (raw: unknown): number {
  return positiveCappedNumber(raw, MAX_CACHE_DURATION_MINUTES, DEFAULT_CACHE_DURATION_MINUTES)
}

/** Config-schema fragment for the ActiveCaptain cache-duration field. */
export function cacheDurationSchema (title: string): Record<string, unknown> {
  // Minimum 1 so the admin UI clamps the field and AJV rejects a 0 or
  // negative submit, matching every other numeric in the plugin schema. The
  // runtime clamp already falls back on a non-positive value, but accepting
  // one in the form and silently overriding it is a confusing UX
  // inconsistency with the bounded sibling fields.
  return boundedNumberSchema(title, DEFAULT_CACHE_DURATION_MINUTES, 1, MAX_CACHE_DURATION_MINUTES)
}
