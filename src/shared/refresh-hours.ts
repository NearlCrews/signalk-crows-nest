/**
 * Bounds, default, clamp, and config-schema fragment for the USCG Light List
 * background refresh period, in hours. Browser-safe (it depends only on the
 * dependency-free `numbers` helper) so the panel's normalize-config and the
 * USCG input module both import the one source of truth, mirroring the
 * year-filter.ts / bbox-debounce.ts shared-bounds pattern.
 */

import { clampNumber } from './numbers.js'
import { boundedNumberSchema } from './config-schema.js'

/**
 * Default USCG Light List refresh period, in hours: daily. NAVCEN publishes
 * Light List updates weekly, and the client's conditional GET makes a
 * no-change refresh nearly free, so a daily check loses nothing while
 * sparing the endpoint three needless sweeps a day.
 */
export const DEFAULT_REFRESH_HOURS = 24

/** Lower bound on the configurable USCG Light List refresh, in hours. */
export const MIN_REFRESH_HOURS = 1

/** Upper bound on the configurable USCG Light List refresh, in hours (one week). */
export const MAX_REFRESH_HOURS = 168

/** Clamp a raw refresh-hours config value into `[MIN, MAX]`, falling back to the default. */
export function clampRefreshHours (raw: unknown): number {
  return clampNumber(raw, MIN_REFRESH_HOURS, MAX_REFRESH_HOURS, DEFAULT_REFRESH_HOURS)
}

/** Config-schema fragment for the USCG Light List refresh-hours field. */
export function refreshHoursSchema (title: string): Record<string, unknown> {
  return boundedNumberSchema(title, DEFAULT_REFRESH_HOURS, MIN_REFRESH_HOURS, MAX_REFRESH_HOURS)
}
