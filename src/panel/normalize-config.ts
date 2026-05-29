/**
 * Coercion of the admin UI's untyped `configuration` prop into a fully
 * populated PluginConfig. Kept React-free so it can be unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../shared/poi-type-selection.js'
import { positiveFiniteNumber } from '../shared/numbers.js'
import { SEAMARK_GROUP_IDS } from '../shared/seamark-groups.js'
import type { PluginConfig } from '../shared/types.js'

/**
 * Fallback caching duration. Mirrors DEFAULT_CACHING_DURATION_MINUTES in
 * src/inputs/active-captain/active-captain-input.ts; keep the two in step so
 * the panel and the plugin agree.
 */
export const DEFAULT_CACHE_DURATION_MINUTES = 60

// The rating bounds, default, and clamp helper are owned by
// src/shared/rating.ts so the panel and the ActiveCaptain input module consume
// the same source of truth. Re-exported here so panel components that already
// import from normalize-config do not need a second import line.
export { MIN_RATING, MAX_RATING, DEFAULT_MINIMUM_RATING } from '../shared/rating.js'
import { clampMinimumRating } from '../shared/rating.js'

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
 * Fallback merge radius, in meters, for OpenSeaMap dedupe against the
 * ActiveCaptain base. Mirrors the `openSeaMapDedupeRadiusMeters` schema
 * default and the `DEFAULT_DEDUPE_RADIUS_METERS` constant in
 * src/inputs/dedupe-pois.ts; keep them in step so the panel and the plugin
 * agree.
 */
export const DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS = 150

/**
 * Fallback USCG Light List background refresh period, in hours. Mirrors the
 * `uscgLightListRefreshHours` schema default in
 * src/inputs/uscg-light-list/uscg-light-list-input.ts; keep the two in step so
 * the panel and the plugin agree.
 */
export const DEFAULT_USCG_LIGHT_LIST_REFRESH_HOURS = 6

/** Lower and upper bounds on the configurable USCG Light List refresh, in hours. */
export const MIN_USCG_LIGHT_LIST_REFRESH_HOURS = 1
export const MAX_USCG_LIGHT_LIST_REFRESH_HOURS = 168

/**
 * Fallback NOAA ENC scale band. Mirrors the `noaaEncScaleBand` schema default
 * in src/inputs/noaa-enc/noaa-enc-input.ts; keep the two in step so the panel
 * and the plugin agree.
 */
export const DEFAULT_NOAA_ENC_SCALE_BAND = 'coastal'

/** The six NOAA ENC chart scale bands, ordered overview to berthing. */
export const NOAA_ENC_SCALE_BANDS = [
  'overview', 'general', 'coastal', 'approach', 'harbour', 'berthing'
] as const

// The minimum-year filter bounds, default, and clamp helper are owned by
// src/shared/year-filter.ts so the panel and the three input modules consume
// the same source of truth. Re-exported here so panel components that
// already import from normalize-config do not need a second import line.
export { DEFAULT_MINIMUM_YEAR, MAX_YEAR, MIN_YEAR } from '../shared/year-filter.js'
import { clampMinimumYear } from '../shared/year-filter.js'

// The bbox-debounce bounds, default, and clamp helper are owned by
// src/shared/bbox-debounce.ts so the panel and the three input modules
// consume the same source of truth. Re-exported here under the legacy
// REFRESH_SECONDS names so panel components that already import from
// normalize-config do not need a second import line.
export {
  MIN_BBOX_DEBOUNCE_SECONDS as MIN_REFRESH_SECONDS,
  MAX_BBOX_DEBOUNCE_SECONDS as MAX_REFRESH_SECONDS,
  DEFAULT_BBOX_DEBOUNCE_SECONDS as DEFAULT_REFRESH_SECONDS
} from '../shared/bbox-debounce.js'
import { clampBboxDebounceSeconds } from '../shared/bbox-debounce.js'

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

  const config: PluginConfig = {
    cachingDurationMinutes:
      positiveFiniteNumber(raw.cachingDurationMinutes) ?? DEFAULT_CACHE_DURATION_MINUTES
  }
  for (const [flag] of POI_TYPE_FLAGS) {
    config[flag] = raw[flag] !== false
  }

  config.minimumRating = clampMinimumRating(raw.minimumRating)

  config.enableProximityAlarms = raw.enableProximityAlarms === true

  // A zero or negative radius would leave the alarm enabled but unable to ever
  // fire, so it is treated as unusable and falls back to the default.
  config.proximityAlarmRadiusMeters =
    positiveFiniteNumber(raw.proximityAlarmRadiusMeters) ?? DEFAULT_PROXIMITY_ALARM_RADIUS_METERS

  config.enableRouteHazardScan = raw.enableRouteHazardScan === true

  // A zero or negative width would leave the scan enabled but unable to ever
  // flag a point of interest, so it is treated as unusable and falls back to
  // the default.
  config.routeCorridorWidthMeters =
    positiveFiniteNumber(raw.routeCorridorWidthMeters) ?? DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS

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

  // Dedupe defaults on, matching the schema: an old config that omits the key
  // still merges OpenSeaMap duplicates of an ActiveCaptain marker. Only an
  // explicit false turns it off.
  config.openSeaMapDedupe = raw.openSeaMapDedupe !== false

  // A zero or negative dedupe radius would leave dedupe enabled but unable to
  // ever match, so it is treated as unusable and falls back to the default.
  config.openSeaMapDedupeRadiusMeters =
    positiveFiniteNumber(raw.openSeaMapDedupeRadiusMeters) ?? DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS

  config.uscgLightListEnabled = raw.uscgLightListEnabled === true
  // Dedupe defaults on, matching the schema: an old config that omits the key
  // still merges Light List entries that duplicate an ActiveCaptain marker.
  // Only an explicit false turns it off.
  config.uscgLightListDedupe = raw.uscgLightListDedupe !== false
  // Per-source merge radius. A zero or non-positive value falls back to the
  // shared default rather than leaving dedupe enabled but unable to match.
  config.uscgLightListDedupeRadiusMeters =
    positiveFiniteNumber(raw.uscgLightListDedupeRadiusMeters) ?? DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS

  // A non-numeric, infinite, or out-of-range refresh period falls back to the
  // default rather than letting the scheduler misbehave.
  const refreshHours = raw.uscgLightListRefreshHours
  config.uscgLightListRefreshHours =
    typeof refreshHours === 'number' && Number.isFinite(refreshHours) &&
    refreshHours >= MIN_USCG_LIGHT_LIST_REFRESH_HOURS &&
    refreshHours <= MAX_USCG_LIGHT_LIST_REFRESH_HOURS
      ? refreshHours
      : DEFAULT_USCG_LIGHT_LIST_REFRESH_HOURS

  config.noaaEncEnabled = raw.noaaEncEnabled === true
  // Dedupe defaults on, matching the schema: only an explicit false turns it off.
  config.noaaEncDedupe = raw.noaaEncDedupe !== false
  // Per-source merge radius. Same fallback semantic as the USCG key above.
  config.noaaEncDedupeRadiusMeters =
    positiveFiniteNumber(raw.noaaEncDedupeRadiusMeters) ?? DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS

  // A non-string or unknown band falls back to the default rather than leaving
  // the source unable to resolve a layer-id triple.
  const scaleBand = raw.noaaEncScaleBand
  config.noaaEncScaleBand =
    typeof scaleBand === 'string' && (NOAA_ENC_SCALE_BANDS as readonly string[]).includes(scaleBand)
      ? scaleBand
      : DEFAULT_NOAA_ENC_SCALE_BAND

  // Wrecks and obstructions default on; only an explicit false turns them off.
  // Rocks default off because a coastal-band query can return tens of thousands
  // of underwater rocks; only an explicit true opts in.
  config.noaaEncIncludeWrecks = raw.noaaEncIncludeWrecks !== false
  config.noaaEncIncludeObstructions = raw.noaaEncIncludeObstructions !== false
  config.noaaEncIncludeRocks = raw.noaaEncIncludeRocks === true

  // Per-source minimum-year filters. Each defaults to 0 (off); the shared
  // clampMinimumYear helper handles non-numeric, non-finite, and
  // out-of-range values.
  config.openSeaMapMinimumYear = clampMinimumYear(raw.openSeaMapMinimumYear)
  config.uscgLightListMinimumUpdateYear = clampMinimumYear(raw.uscgLightListMinimumUpdateYear)
  config.noaaEncMinimumSurveyYear = clampMinimumYear(raw.noaaEncMinimumSurveyYear)

  // Per-bbox debounce windows for every source. Default 30 s. Delegated
  // to the shared clamp in src/shared/bbox-debounce.ts.
  config.openSeaMapRefreshSeconds = clampBboxDebounceSeconds(raw.openSeaMapRefreshSeconds)
  config.noaaEncRefreshSeconds = clampBboxDebounceSeconds(raw.noaaEncRefreshSeconds)
  config.activeCaptainRefreshSeconds = clampBboxDebounceSeconds(raw.activeCaptainRefreshSeconds)

  return config
}
