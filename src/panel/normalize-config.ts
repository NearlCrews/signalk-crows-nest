/**
 * Coercion of the admin UI's untyped `configuration` prop into a fully
 * populated PluginConfig. Kept React-free so it can be unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../shared/poi-type-selection.js'
import { toFiniteNumber } from '../shared/numbers.js'
import { SEAMARK_GROUP_IDS } from '../shared/seamark-groups.js'
import type { PluginConfig } from '../shared/types.js'

// Every bound, default, and clamp below is owned by its src/shared module;
// panel components import those owners directly, so this module imports only
// the helpers normalizeConfig itself resolves with.
import { clampCacheDurationMinutes } from '../shared/cache-duration.js'
import { clampMinimumRating } from '../shared/rating.js'
import { clampProximityAlarmRadius } from '../shared/proximity-radius.js'
import { clampRouteCorridorWidth } from '../shared/route-corridor.js'
import { normalizeFallbackEndpoints, resolvePrimaryEndpoint } from '../shared/overpass-endpoints.js'
import { clampDedupeRadius } from '../shared/dedupe-radius.js'
import { clampRefreshHours } from '../shared/refresh-hours.js'
import { resolveScaleBand } from '../shared/scale-band.js'
import { clampMinimumYear } from '../shared/year-filter.js'
import { clampClearanceMargin, NO_FALLBACK_AIR_DRAFT_METERS } from '../shared/bridge-clearance.js'
import {
  clampBboxDebounceSeconds,
  DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS,
  DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS,
  DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS
} from '../shared/bbox-debounce.js'
import { normalizeRouteDraftConfig } from '../route-draft/config.js'

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
    cachingDurationMinutes: clampCacheDurationMinutes(raw.cachingDurationMinutes)
  }
  for (const [flag] of POI_TYPE_FLAGS) {
    config[flag] = raw[flag] !== false
  }

  config.minimumRating = clampMinimumRating(raw.minimumRating)

  config.enableProximityAlarms = raw.enableProximityAlarms === true

  // A zero or negative radius would leave the alarm enabled but unable to ever
  // fire, so it is treated as unusable and falls back to the default.
  config.proximityAlarmRadiusMeters = clampProximityAlarmRadius(raw.proximityAlarmRadiusMeters)

  config.enableRouteHazardScan = raw.enableRouteHazardScan === true

  // A zero or negative width would leave the scan enabled but unable to ever
  // flag a point of interest, so it is treated as unusable and falls back to
  // the default.
  config.routeCorridorWidthMeters = clampRouteCorridorWidth(raw.routeCorridorWidthMeters)

  config.enableBridgeAirDraftCheck = raw.enableBridgeAirDraftCheck === true

  // The fallback air draft. Zero is valid and means rely on `design.airHeight`
  // alone, so unlike a radius or width this floors at the no-fallback sentinel
  // rather than falling back to a non-zero default: a non-numeric, non-finite,
  // or negative value becomes the sentinel.
  const airDraft = toFiniteNumber(raw.vesselAirDraftMeters)
  config.vesselAirDraftMeters = airDraft !== null && airDraft >= 0
    ? airDraft
    : NO_FALLBACK_AIR_DRAFT_METERS

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
    clampDedupeRadius(raw.openSeaMapDedupeRadiusMeters)

  config.uscgLightListEnabled = raw.uscgLightListEnabled === true
  // Dedupe defaults on, matching the schema: an old config that omits the key
  // still merges Light List entries that duplicate an ActiveCaptain marker.
  // Only an explicit false turns it off.
  config.uscgLightListDedupe = raw.uscgLightListDedupe !== false
  // Per-source merge radius. A zero or non-positive value falls back to the
  // shared default rather than leaving dedupe enabled but unable to match.
  config.uscgLightListDedupeRadiusMeters =
    clampDedupeRadius(raw.uscgLightListDedupeRadiusMeters)

  // The same shared clamp the input module applies, so the panel shows the
  // value the runtime scheduler will actually use: an out-of-range stored
  // value clamps into [MIN, MAX] rather than silently reading as the default.
  config.uscgLightListRefreshHours = clampRefreshHours(raw.uscgLightListRefreshHours)

  config.noaaEncEnabled = raw.noaaEncEnabled === true
  // Dedupe defaults on, matching the schema: only an explicit false turns it off.
  config.noaaEncDedupe = raw.noaaEncDedupe !== false
  // Per-source merge radius. Same fallback semantic as the USCG key above.
  config.noaaEncDedupeRadiusMeters =
    clampDedupeRadius(raw.noaaEncDedupeRadiusMeters)

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

  // Per-bbox debounce windows, with each source's own default (30 s for
  // ActiveCaptain, longer for the slower-moving upstreams). Delegated to the
  // shared clamp in src/shared/bbox-debounce.ts.
  config.openSeaMapRefreshSeconds = clampBboxDebounceSeconds(
    raw.openSeaMapRefreshSeconds, DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS
  )
  config.noaaEncRefreshSeconds = clampBboxDebounceSeconds(
    raw.noaaEncRefreshSeconds, DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS
  )
  config.activeCaptainRefreshSeconds = clampBboxDebounceSeconds(
    raw.activeCaptainRefreshSeconds, DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS
  )

  // The route-draft module owns its own clamp; spread its 13 fully clamped
  // keys, so a non-numeric or out-of-range stored value lands on its default
  // or nearest bound rather than reaching the panel or the runtime.
  Object.assign(config, normalizeRouteDraftConfig(raw))

  return config
}
