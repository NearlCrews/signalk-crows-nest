/**
 * Coercion of the admin UI's untyped `configuration` prop into a fully
 * populated PluginConfig. Kept React-free so it can be unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../shared/poi-type-selection.js'
import { positiveFiniteNumber, toFiniteNumber } from '../shared/numbers.js'
import { SEAMARK_GROUP_IDS } from '../shared/seamark-groups.js'
import type { PluginConfig } from '../shared/types.js'

// The ActiveCaptain detail-cache default is owned by
// src/shared/cache-duration.ts so the panel and the ActiveCaptain input module
// consume one value. Imported because normalizeConfig falls back to it, and
// re-exported so panel components and tests that already import from
// normalize-config do not need a second import line.
import { DEFAULT_CACHE_DURATION_MINUTES } from '../shared/cache-duration.js'
export { DEFAULT_CACHE_DURATION_MINUTES }

// The rating bounds, default, and clamp helper are owned by
// src/shared/rating.ts so the panel and the ActiveCaptain input module consume
// the same source of truth. Re-exported here so panel components that already
// import from normalize-config do not need a second import line.
export { MIN_RATING, MAX_RATING, DEFAULT_MINIMUM_RATING } from '../shared/rating.js'
import { clampMinimumRating } from '../shared/rating.js'

// The proximity-alarm radius default is owned by src/shared/proximity-radius.ts
// so the panel, the proximity-alarm output, and the bridge air-draft output
// consume the same source of truth. Imported here because normalizeConfig falls
// back to it, and re-exported so panel components and tests that already import
// from normalize-config do not need a second import line.
import { DEFAULT_PROXIMITY_ALARM_RADIUS_METERS } from '../shared/proximity-radius.js'
export { DEFAULT_PROXIMITY_ALARM_RADIUS_METERS }

// The route-corridor half-width default is owned by src/shared/route-corridor.ts
// so the panel and the route-hazard output consume one value. Imported because
// normalizeConfig falls back to it, and re-exported for panel components and
// tests that already import from normalize-config.
import { DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS } from '../shared/route-corridor.js'
export { DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS }

/**
 * Fallback Overpass API endpoint for the OpenSeaMap source. Re-exported from
 * the shared `overpass-endpoints` module, which is the single source of truth
 * the input module's schema default also reads, so the panel and the plugin
 * cannot drift. The recommended fallback-mirror suggestions live there too.
 */
export {
  DEFAULT_OVERPASS_ENDPOINT as DEFAULT_OPENSEAMAP_ENDPOINT,
  RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS
} from '../shared/overpass-endpoints.js'
import { normalizeFallbackEndpoints, resolvePrimaryEndpoint } from '../shared/overpass-endpoints.js'

// The dedupe merge-radius default is owned by src/shared/dedupe-radius.ts so the
// panel and the dedupe module consume one value. It backs all three non-base
// sources (OpenSeaMap, USCG, NOAA), so it is named for the dedupe, not for one
// source. Imported because normalizeConfig falls back to it, and re-exported for
// panel components and tests that already import from normalize-config.
import { DEFAULT_DEDUPE_RADIUS_METERS } from '../shared/dedupe-radius.js'
export { DEFAULT_DEDUPE_RADIUS_METERS }

// The USCG refresh-hours bounds and default are owned by
// src/shared/refresh-hours.ts. Imported because normalizeConfig validates with
// them, and re-exported under the panel's existing names so the USCG card and
// the status section that already import from normalize-config do not change.
// The panel keeps its own out-of-range-to-default rule here (the input module
// clamps instead); only the bounds are shared.
import { DEFAULT_REFRESH_HOURS, MIN_REFRESH_HOURS, MAX_REFRESH_HOURS } from '../shared/refresh-hours.js'
export {
  DEFAULT_REFRESH_HOURS as DEFAULT_USCG_LIGHT_LIST_REFRESH_HOURS,
  MIN_REFRESH_HOURS as MIN_USCG_LIGHT_LIST_REFRESH_HOURS,
  MAX_REFRESH_HOURS as MAX_USCG_LIGHT_LIST_REFRESH_HOURS
} from '../shared/refresh-hours.js'

// The NOAA scale bands, default, and validation are owned by
// src/shared/scale-band.ts. Imported because normalizeConfig resolves with them,
// and re-exported under the panel's existing names so the NOAA card and the
// status section that already import from normalize-config do not change.
import { resolveScaleBand } from '../shared/scale-band.js'
export {
  DEFAULT_SCALE_BAND as DEFAULT_NOAA_ENC_SCALE_BAND,
  SCALE_BANDS as NOAA_ENC_SCALE_BANDS
} from '../shared/scale-band.js'

// The minimum-year filter bounds, default, and clamp helper are owned by
// src/shared/year-filter.ts so the panel and the three input modules consume
// the same source of truth. Re-exported here so panel components that
// already import from normalize-config do not need a second import line.
export { DEFAULT_MINIMUM_YEAR, MAX_YEAR, MIN_YEAR } from '../shared/year-filter.js'
import { clampMinimumYear } from '../shared/year-filter.js'

// The clearance-margin bounds, default, and clamp helper are owned by
// src/shared/bridge-clearance.ts so the panel and the bridge air-draft output
// consume the same source of truth. Re-exported here so panel components that
// already import from normalize-config do not need a second import line.
export {
  DEFAULT_CLEARANCE_MARGIN_METERS,
  MIN_CLEARANCE_MARGIN_METERS,
  MAX_CLEARANCE_MARGIN_METERS
} from '../shared/bridge-clearance.js'
import { clampClearanceMargin } from '../shared/bridge-clearance.js'

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

  config.enableBridgeAirDraftCheck = raw.enableBridgeAirDraftCheck === true

  // The fallback air draft. Zero is valid and means rely on `design.airHeight`
  // alone, so unlike a radius or width this floors at zero rather than falling
  // back to a non-zero default: a non-numeric, non-finite, or negative value
  // becomes 0.
  const airDraft = toFiniteNumber(raw.vesselAirDraftMeters)
  config.vesselAirDraftMeters = airDraft !== null && airDraft >= 0 ? airDraft : 0

  // The clearance margin is clamped to the shared [MIN, MAX] bounds; a
  // non-numeric or non-finite value falls back to the shared default.
  config.bridgeClearanceMarginMeters = clampClearanceMargin(raw.bridgeClearanceMarginMeters)

  config.openSeaMapEnabled = raw.openSeaMapEnabled === true

  // A blank or non-string endpoint would leave the source unable to query, so
  // it falls back to the default Overpass endpoint (shared with the input
  // module's schema default via resolvePrimaryEndpoint).
  config.openSeaMapEndpoint = resolvePrimaryEndpoint(raw.openSeaMapEndpoint)

  // Optional fallback mirrors, tried in order when the primary fails. Cleaned
  // to a deduped, blank-free list (an old config that omits the key yields []).
  config.openSeaMapFallbackEndpoints = normalizeFallbackEndpoints(raw.openSeaMapFallbackEndpoints)

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
    positiveFiniteNumber(raw.openSeaMapDedupeRadiusMeters) ?? DEFAULT_DEDUPE_RADIUS_METERS

  config.uscgLightListEnabled = raw.uscgLightListEnabled === true
  // Dedupe defaults on, matching the schema: an old config that omits the key
  // still merges Light List entries that duplicate an ActiveCaptain marker.
  // Only an explicit false turns it off.
  config.uscgLightListDedupe = raw.uscgLightListDedupe !== false
  // Per-source merge radius. A zero or non-positive value falls back to the
  // shared default rather than leaving dedupe enabled but unable to match.
  config.uscgLightListDedupeRadiusMeters =
    positiveFiniteNumber(raw.uscgLightListDedupeRadiusMeters) ?? DEFAULT_DEDUPE_RADIUS_METERS

  // A non-numeric, infinite, or out-of-range refresh period falls back to the
  // default rather than letting the scheduler misbehave.
  const refreshHours = raw.uscgLightListRefreshHours
  config.uscgLightListRefreshHours =
    typeof refreshHours === 'number' && Number.isFinite(refreshHours) &&
    refreshHours >= MIN_REFRESH_HOURS &&
    refreshHours <= MAX_REFRESH_HOURS
      ? refreshHours
      : DEFAULT_REFRESH_HOURS

  config.noaaEncEnabled = raw.noaaEncEnabled === true
  // Dedupe defaults on, matching the schema: only an explicit false turns it off.
  config.noaaEncDedupe = raw.noaaEncDedupe !== false
  // Per-source merge radius. Same fallback semantic as the USCG key above.
  config.noaaEncDedupeRadiusMeters =
    positiveFiniteNumber(raw.noaaEncDedupeRadiusMeters) ?? DEFAULT_DEDUPE_RADIUS_METERS

  // A non-string or unknown band falls back to the default rather than leaving
  // the source unable to resolve a layer-id triple.
  config.noaaEncScaleBand = resolveScaleBand(raw.noaaEncScaleBand)

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
