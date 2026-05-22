/**
 * Coercion of the admin UI's untyped `configuration` prop into a fully
 * populated PluginConfig. Kept React-free so it can be unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../shared/poi-type-selection.js'
import type { PluginConfig } from '../shared/types.js'
import { SEAMARK_GROUP_IDS } from './seamark-groups.js'

/**
 * Fallback caching duration. Mirrors DEFAULT_CACHING_DURATION_MINUTES in
 * src/inputs/active-captain/active-captain-input.ts; keep the two in step so
 * the panel and the plugin agree.
 */
export const DEFAULT_CACHE_DURATION_MINUTES = 60

/** Lowest minimum rating: 0 disables the rating filter and shows every point. */
export const MIN_RATING = 0

/** Highest minimum rating ActiveCaptain awards. */
export const MAX_RATING = 5

/**
 * Fallback minimum rating. Mirrors the `minimumRating` schema default in
 * src/outputs/notes-resource/notes-resource-output.ts; keep the two in step so
 * the panel and the plugin agree.
 */
export const DEFAULT_MINIMUM_RATING = MIN_RATING

/**
 * Fallback proximity-alarm radius, in meters. Mirrors the
 * `proximityAlarmRadiusMeters` schema default in
 * src/outputs/proximity-alarm/proximity-alarm-output.ts; keep the two in step
 * so the panel and the plugin agree.
 */
export const DEFAULT_PROXIMITY_ALARM_RADIUS_METERS = 500

/**
 * Fallback route-corridor half-width, in meters. Mirrors the
 * `routeCorridorWidthMeters` schema default in
 * src/outputs/route-hazard/route-hazard-output.ts; keep the two in step so the
 * panel and the plugin agree.
 */
export const DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS = 500

/**
 * Fallback Overpass API endpoint for the OpenSeaMap source. Mirrors the
 * `openSeaMapEndpoint` schema default in
 * src/inputs/openseamap/openseamap-input.ts; keep the two in step so the panel
 * and the plugin agree.
 */
export const DEFAULT_OPENSEAMAP_ENDPOINT = 'https://overpass-api.de/api/interpreter'

/**
 * Coerce the admin UI's untyped `configuration` prop into a fully populated
 * PluginConfig. A POI-type flag absent from the stored config defaults to
 * true, matching the plugin schema, so a never-configured plugin shows every
 * type enabled rather than appearing to import nothing. A non-positive or
 * non-numeric cache duration falls back to the default. The minimum rating,
 * the proximity-alarm toggle, and the alarm radius each fall back to their
 * schema default when absent or unusable, and the rating is clamped to its
 * valid range.
 */
export function normalizeConfig (configuration: unknown): PluginConfig {
  const raw = (typeof configuration === 'object' && configuration !== null)
    ? configuration as Record<string, unknown>
    : {}

  const minutes = raw.cachingDurationMinutes
  const config: PluginConfig = {
    cachingDurationMinutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_CACHE_DURATION_MINUTES
  }
  for (const [flag] of POI_TYPE_FLAGS) {
    config[flag] = raw[flag] !== false
  }

  const rating = raw.minimumRating
  config.minimumRating = typeof rating === 'number' && Number.isFinite(rating)
    ? Math.min(MAX_RATING, Math.max(MIN_RATING, rating))
    : DEFAULT_MINIMUM_RATING

  config.enableProximityAlarms = raw.enableProximityAlarms === true

  // A zero or negative radius would leave the alarm enabled but unable to ever
  // fire, so it is treated as unusable and falls back to the default.
  const radius = raw.proximityAlarmRadiusMeters
  config.proximityAlarmRadiusMeters = typeof radius === 'number' && Number.isFinite(radius) && radius > 0
    ? radius
    : DEFAULT_PROXIMITY_ALARM_RADIUS_METERS

  config.enableRouteHazardScan = raw.enableRouteHazardScan === true

  // A zero or negative width would leave the scan enabled but unable to ever
  // flag a point of interest, so it is treated as unusable and falls back to
  // the default.
  const corridorWidth = raw.routeCorridorWidthMeters
  config.routeCorridorWidthMeters =
    typeof corridorWidth === 'number' && Number.isFinite(corridorWidth) && corridorWidth > 0
      ? corridorWidth
      : DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS

  config.openSeaMapEnabled = raw.openSeaMapEnabled === true

  // A blank or non-string endpoint would leave the source unable to query, so
  // it falls back to the default Overpass endpoint.
  const endpoint = raw.openSeaMapEndpoint
  config.openSeaMapEndpoint = typeof endpoint === 'string' && endpoint.trim() !== ''
    ? endpoint
    : DEFAULT_OPENSEAMAP_ENDPOINT

  // An old config omits the seamark groups entirely; it then imports every
  // group. An explicit array is kept, filtered to the known group ids, so a
  // user can legitimately narrow or even clear the selection.
  const seamarkGroups = raw.openSeaMapSeamarkGroups
  config.openSeaMapSeamarkGroups = Array.isArray(seamarkGroups)
    ? (seamarkGroups as unknown[]).filter(
        (group): group is string => typeof group === 'string' && SEAMARK_GROUP_IDS.includes(group))
    : [...SEAMARK_GROUP_IDS]

  return config
}
