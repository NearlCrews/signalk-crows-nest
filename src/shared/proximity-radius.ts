/**
 * Vessel-proximity alarm geometry shared by the proximity hazard output and the
 * bridge air-draft output.
 *
 * Both outputs raise an alarm when the vessel comes within a radius of a point
 * of interest, both size their per-tick fetch box the same way (wider than the
 * alarm radius, with a floor), and both clear with the same hysteresis. The
 * shared default, bounds, factors, and the scan-radius helper live here so the
 * two outputs, the two alarm modules, and the panel's normalize-config cannot
 * drift, mirroring the rating.ts / year-filter.ts / bbox-debounce.ts pattern.
 * This module is dependency-free, so the browser-bundled panel can import the
 * default.
 */

import { positiveCappedNumber } from './numbers.js'
import { boundedNumberSchema } from './config-schema.js'

/** Default vessel-proximity alarm radius, in meters; mirrors the schema default. */
export const DEFAULT_PROXIMITY_ALARM_RADIUS_METERS = 500

/**
 * Upper bound on the alarm radius. Generous (100 km is far beyond any real
 * proximity-alarm use), but it caps the per-tick fetch box a hand-edited
 * config could otherwise blow up to an absurd size.
 */
export const MAX_PROXIMITY_ALARM_RADIUS_METERS = 100_000

/** Lower bound on the per-tick fetch radius, so the alarm check always has data. */
const MIN_SCAN_RADIUS_METERS = 2000

/**
 * Multiple of the alarm radius the fetch box is widened to, so a point of
 * interest is fetched well before it crosses the alarm radius.
 */
const SCAN_RADIUS_FACTOR = 3

/**
 * Hysteresis margin: an active alarm clears only once the point of interest is
 * this multiple of the alarm radius away. The gap between the raise distance
 * and the clear distance stops an alarm chattering when a point of interest
 * sits right on the boundary.
 */
const EXIT_RADIUS_FACTOR = 1.2

/**
 * Resolve a raw alarm-radius config value: a non-positive or non-numeric value
 * falls back to {@link DEFAULT_PROXIMITY_ALARM_RADIUS_METERS} (matching the
 * other optional numeric config keys), and the result is capped at
 * {@link MAX_PROXIMITY_ALARM_RADIUS_METERS}. Shared by the proximity output
 * and the panel's normalize-config so the two cannot drift.
 */
export function clampProximityAlarmRadius (raw: unknown): number {
  return positiveCappedNumber(raw, MAX_PROXIMITY_ALARM_RADIUS_METERS, DEFAULT_PROXIMITY_ALARM_RADIUS_METERS)
}

/** Config-schema fragment for the proximity alarm radius field. */
export function proximityRadiusSchema (title: string): Record<string, unknown> {
  return boundedNumberSchema(title, DEFAULT_PROXIMITY_ALARM_RADIUS_METERS, 1, MAX_PROXIMITY_ALARM_RADIUS_METERS)
}

/**
 * The distance threshold for an alarm, applying hysteresis: an alarm not yet
 * active triggers within `radiusMeters`, while an already-active alarm stays
 * raised until the point of interest passes the wider clear radius
 * ({@link EXIT_RADIUS_FACTOR} times the radius). The gap between the two stops
 * an alarm chattering when a point of interest sits right on the boundary. The
 * two alarm modules share this so `EXIT_RADIUS_FACTOR` stays in one place.
 */
export function hysteresisThreshold (radiusMeters: number, isActive: boolean): number {
  return isActive ? radiusMeters * EXIT_RADIUS_FACTOR : radiusMeters
}

/**
 * Size the per-tick fetch radius from an alarm radius: wider than the alarm
 * radius by {@link SCAN_RADIUS_FACTOR}, with a {@link MIN_SCAN_RADIUS_METERS}
 * floor so a small alarm radius still fetches enough surrounding data.
 */
export function vesselScanRadiusMeters (alarmRadiusMeters: number): number {
  return Math.max(alarmRadiusMeters * SCAN_RADIUS_FACTOR, MIN_SCAN_RADIUS_METERS)
}
