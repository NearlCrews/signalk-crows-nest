/**
 * Pure reducer over the plugin's PluginConfig shape, driving the configuration
 * panel's working state. It carries no React dependency, so it is exported and
 * unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../shared/poi-type-selection.js'
import type { RouteDraftPropulsion } from '../route-draft/config.js'
import type { PluginConfig, PoiTypeFlag } from '../shared/types.js'

/** Actions the panel dispatches to mutate its working configuration. */
export type ConfigAction =
  | { type: 'setCacheDuration', minutes: number }
  | { type: 'setPoiType', flag: PoiTypeFlag, enabled: boolean }
  | { type: 'setAllPoiTypes', enabled: boolean }
  | { type: 'setMinimumRating', rating: number }
  | { type: 'setProximityAlarmsEnabled', enabled: boolean }
  | { type: 'setProximityAlarmRadius', meters: number }
  | { type: 'setRouteHazardScanEnabled', enabled: boolean }
  | { type: 'setRouteCorridorWidth', meters: number }
  | { type: 'setBridgeAirDraftCheckEnabled', enabled: boolean }
  | { type: 'setVesselAirDraft', meters: number }
  | { type: 'setBridgeClearanceMargin', meters: number }
  | { type: 'setOpenSeaMapEnabled', enabled: boolean }
  | { type: 'setOpenSeaMapEndpoint', endpoint: string }
  | { type: 'setOpenSeaMapFallbackEndpoints', endpoints: string[] }
  | { type: 'setOpenSeaMapSeamarkGroups', groups: string[] }
  | { type: 'setOpenSeaMapDedupe', enabled: boolean }
  | { type: 'setOpenSeaMapDedupeRadius', meters: number }
  | { type: 'setUscgLightListEnabled', enabled: boolean }
  | { type: 'setUscgLightListDedupe', enabled: boolean }
  | { type: 'setUscgLightListDedupeRadius', meters: number }
  | { type: 'setUscgLightListRefreshHours', hours: number }
  | { type: 'setNoaaEncEnabled', enabled: boolean }
  | { type: 'setNoaaEncDedupe', enabled: boolean }
  | { type: 'setNoaaEncDedupeRadius', meters: number }
  | { type: 'setNoaaEncScaleBand', band: string }
  | { type: 'setNoaaEncIncludeWrecks', enabled: boolean }
  | { type: 'setNoaaEncIncludeObstructions', enabled: boolean }
  | { type: 'setNoaaEncIncludeRocks', enabled: boolean }
  | { type: 'setOpenSeaMapMinimumYear', year: number }
  | { type: 'setUscgLightListMinimumUpdateYear', year: number }
  | { type: 'setNoaaEncMinimumSurveyYear', year: number }
  | { type: 'setOpenSeaMapRefreshSeconds', seconds: number }
  | { type: 'setNoaaEncRefreshSeconds', seconds: number }
  | { type: 'setActiveCaptainRefreshSeconds', seconds: number }
  | { type: 'setRouteDraftEnabled', enabled: boolean }
  | { type: 'setRouteDraftOpenRouterApiKey', key: string }
  | { type: 'setRouteDraftModel', model: string }
  | { type: 'setRouteDraftMaxCallsPerDay', calls: number }
  | { type: 'setRouteDraftPropulsion', propulsion: RouteDraftPropulsion }
  | { type: 'setRouteDraftDraftMeters', meters: number }
  | { type: 'setRouteDraftSafetyMarginMeters', meters: number }
  | { type: 'setRouteDraftTackingAngleDeg', degrees: number }
  | { type: 'setRouteDraftCruiseSpeedKn', knots: number }
  | { type: 'setRouteDraftBurnLitersPerHour', litersPerHour: number }
  | { type: 'setRouteDraftReservePercent', percent: number }
  | { type: 'setRouteDraftStandoffNm', nauticalMiles: number }
  | { type: 'setRouteDraftMaxLegNm', nauticalMiles: number }
  | { type: 'setRouteDraftUseCompanion', enabled: boolean }
  | { type: 'discard', config: PluginConfig }

/**
 * Set one scalar config field, preserving identity on a no-op. Returning the
 * same `state` when the value is unchanged is what lets the panel use identity
 * equality against the last-saved snapshot as a sound dirty check, so every
 * scalar case routes through this one helper rather than repeating the guard.
 */
function setField<K extends keyof PluginConfig> (
  state: PluginConfig, key: K, value: PluginConfig[K]
): PluginConfig {
  return state[key] === value ? state : { ...state, [key]: value }
}

/** True when two string lists are element-for-element equal in the same order. */
function sameOrder (a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Apply an action to the configuration. Each case returns a new object only
 * when something actually changed and returns the input state otherwise, so
 * the panel can use identity equality against the last-saved snapshot as a
 * sound dirty check.
 */
export function configReducer (state: PluginConfig, action: ConfigAction): PluginConfig {
  switch (action.type) {
    case 'discard':
      return action.config
    case 'setCacheDuration':
      return setField(state, 'cachingDurationMinutes', action.minutes)
    case 'setPoiType':
      return setField(state, action.flag, action.enabled)
    case 'setAllPoiTypes': {
      // Build the next state lazily, only once a flag actually differs, so an
      // All / None click that changes nothing preserves identity.
      let next: PluginConfig | null = null
      for (const [flag] of POI_TYPE_FLAGS) {
        if (state[flag] !== action.enabled) {
          next ??= { ...state }
          next[flag] = action.enabled
        }
      }
      return next ?? state
    }
    case 'setMinimumRating':
      return setField(state, 'minimumRating', action.rating)
    case 'setProximityAlarmsEnabled':
      return setField(state, 'enableProximityAlarms', action.enabled)
    case 'setProximityAlarmRadius':
      return setField(state, 'proximityAlarmRadiusMeters', action.meters)
    case 'setRouteHazardScanEnabled':
      return setField(state, 'enableRouteHazardScan', action.enabled)
    case 'setRouteCorridorWidth':
      return setField(state, 'routeCorridorWidthMeters', action.meters)
    case 'setBridgeAirDraftCheckEnabled':
      return setField(state, 'enableBridgeAirDraftCheck', action.enabled)
    case 'setVesselAirDraft':
      return setField(state, 'vesselAirDraftMeters', action.meters)
    case 'setBridgeClearanceMargin':
      return setField(state, 'bridgeClearanceMarginMeters', action.meters)
    case 'setOpenSeaMapEnabled':
      return setField(state, 'openSeaMapEnabled', action.enabled)
    case 'setOpenSeaMapEndpoint':
      return setField(state, 'openSeaMapEndpoint', action.endpoint)
    case 'setOpenSeaMapFallbackEndpoints': {
      const current = state.openSeaMapFallbackEndpoints ?? []
      return sameOrder(current, action.endpoints)
        ? state
        : { ...state, openSeaMapFallbackEndpoints: action.endpoints }
    }
    case 'setOpenSeaMapSeamarkGroups': {
      const current = state.openSeaMapSeamarkGroups ?? []
      return sameOrder(current, action.groups)
        ? state
        : { ...state, openSeaMapSeamarkGroups: action.groups }
    }
    case 'setOpenSeaMapDedupe':
      return setField(state, 'openSeaMapDedupe', action.enabled)
    case 'setOpenSeaMapDedupeRadius':
      return setField(state, 'openSeaMapDedupeRadiusMeters', action.meters)
    case 'setUscgLightListEnabled':
      return setField(state, 'uscgLightListEnabled', action.enabled)
    case 'setUscgLightListDedupe':
      return setField(state, 'uscgLightListDedupe', action.enabled)
    case 'setUscgLightListDedupeRadius':
      return setField(state, 'uscgLightListDedupeRadiusMeters', action.meters)
    case 'setUscgLightListRefreshHours':
      return setField(state, 'uscgLightListRefreshHours', action.hours)
    case 'setNoaaEncEnabled':
      return setField(state, 'noaaEncEnabled', action.enabled)
    case 'setNoaaEncDedupe':
      return setField(state, 'noaaEncDedupe', action.enabled)
    case 'setNoaaEncDedupeRadius':
      return setField(state, 'noaaEncDedupeRadiusMeters', action.meters)
    case 'setNoaaEncScaleBand':
      return setField(state, 'noaaEncScaleBand', action.band)
    case 'setNoaaEncIncludeWrecks':
      return setField(state, 'noaaEncIncludeWrecks', action.enabled)
    case 'setNoaaEncIncludeObstructions':
      return setField(state, 'noaaEncIncludeObstructions', action.enabled)
    case 'setNoaaEncIncludeRocks':
      return setField(state, 'noaaEncIncludeRocks', action.enabled)
    case 'setOpenSeaMapMinimumYear':
      return setField(state, 'openSeaMapMinimumYear', action.year)
    case 'setUscgLightListMinimumUpdateYear':
      return setField(state, 'uscgLightListMinimumUpdateYear', action.year)
    case 'setNoaaEncMinimumSurveyYear':
      return setField(state, 'noaaEncMinimumSurveyYear', action.year)
    case 'setOpenSeaMapRefreshSeconds':
      return setField(state, 'openSeaMapRefreshSeconds', action.seconds)
    case 'setNoaaEncRefreshSeconds':
      return setField(state, 'noaaEncRefreshSeconds', action.seconds)
    case 'setActiveCaptainRefreshSeconds':
      return setField(state, 'activeCaptainRefreshSeconds', action.seconds)
    case 'setRouteDraftEnabled':
      return setField(state, 'routeDraftEnabled', action.enabled)
    case 'setRouteDraftOpenRouterApiKey':
      return setField(state, 'routeDraftOpenRouterApiKey', action.key)
    case 'setRouteDraftModel':
      return setField(state, 'routeDraftModel', action.model)
    case 'setRouteDraftMaxCallsPerDay':
      return setField(state, 'routeDraftMaxCallsPerDay', action.calls)
    case 'setRouteDraftPropulsion':
      return setField(state, 'routeDraftPropulsion', action.propulsion)
    case 'setRouteDraftDraftMeters':
      return setField(state, 'routeDraftDraftMeters', action.meters)
    case 'setRouteDraftSafetyMarginMeters':
      return setField(state, 'routeDraftSafetyMarginMeters', action.meters)
    case 'setRouteDraftTackingAngleDeg':
      return setField(state, 'routeDraftTackingAngleDeg', action.degrees)
    case 'setRouteDraftCruiseSpeedKn':
      return setField(state, 'routeDraftCruiseSpeedKn', action.knots)
    case 'setRouteDraftBurnLitersPerHour':
      return setField(state, 'routeDraftBurnLitersPerHour', action.litersPerHour)
    case 'setRouteDraftReservePercent':
      return setField(state, 'routeDraftReservePercent', action.percent)
    case 'setRouteDraftStandoffNm':
      return setField(state, 'routeDraftStandoffNm', action.nauticalMiles)
    case 'setRouteDraftMaxLegNm':
      return setField(state, 'routeDraftMaxLegNm', action.nauticalMiles)
    case 'setRouteDraftUseCompanion':
      return setField(state, 'routeDraftUseCompanion', action.enabled)
  }
}
