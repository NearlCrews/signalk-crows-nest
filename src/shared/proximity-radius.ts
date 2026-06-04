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

/** Default vessel-proximity alarm radius, in meters; mirrors the schema default. */
export const DEFAULT_PROXIMITY_ALARM_RADIUS_METERS = 500

/** Lower bound on the per-tick fetch radius, so the alarm check always has data. */
export const MIN_SCAN_RADIUS_METERS = 2000

/**
 * Multiple of the alarm radius the fetch box is widened to, so a point of
 * interest is fetched well before it crosses the alarm radius.
 */
export const SCAN_RADIUS_FACTOR = 3

/**
 * Hysteresis margin: an active alarm clears only once the point of interest is
 * this multiple of the alarm radius away. The gap between the raise distance
 * and the clear distance stops an alarm chattering when a point of interest
 * sits right on the boundary.
 */
export const EXIT_RADIUS_FACTOR = 1.2

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
