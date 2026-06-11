/**
 * Dedupe merge-radius default, upper bound, and clamp, for deduplicating a
 * non-base source's POIs against the ActiveCaptain base and as the fallback
 * for each non-base source (OpenSeaMap, USCG Light List, and NOAA ENC) when
 * its own radius is unusable. Browser-safe (the only import is the
 * dependency-free numbers module) so the panel's normalize-config and the
 * dedupe module both import the one set of values, mirroring the rating.ts
 * shared-bounds pattern. Named for what it is (a dedupe radius), not for one
 * of the sources that uses it.
 */

import { positiveCappedNumber, positiveFiniteNumber } from './numbers.js'

/** Default merge radius, in meters. */
export const DEFAULT_DEDUPE_RADIUS_METERS = 150

/**
 * Upper bound on the merge radius: beyond 10 km, two reports can no longer
 * plausibly describe the same physical feature, so a larger hand-edited value
 * would only merge unrelated markers away.
 */
export const MAX_DEDUPE_RADIUS_METERS = 10_000

/**
 * Resolve a raw per-source merge-radius config value: a non-positive or
 * non-numeric value resolves to `null` (each consumer falls back to
 * {@link DEFAULT_DEDUPE_RADIUS_METERS} itself, matching the optional-default
 * pattern), and a usable value is capped at
 * {@link MAX_DEDUPE_RADIUS_METERS}. Shared by the three non-base input
 * modules and the panel's normalize-config so the two sides cannot drift.
 */
export function cappedDedupeRadius (raw: unknown): number | null {
  const value = positiveFiniteNumber(raw)
  return value === null ? null : Math.min(value, MAX_DEDUPE_RADIUS_METERS)
}

/**
 * The non-nullable form of {@link cappedDedupeRadius}: an unusable value
 * resolves to {@link DEFAULT_DEDUPE_RADIUS_METERS} directly, matching the
 * `clampX` shape every sibling bounds module exposes. The panel's
 * normalize-config uses this; the input modules keep the nullable form,
 * whose `null` is the registry's own fall-back-to-default signal.
 */
export function clampDedupeRadius (raw: unknown): number {
  return positiveCappedNumber(raw, MAX_DEDUPE_RADIUS_METERS, DEFAULT_DEDUPE_RADIUS_METERS)
}
