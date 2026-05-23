/**
 * Pure reducer over the plugin's PluginConfig shape, driving the configuration
 * panel's working state. It carries no React dependency, so it is exported and
 * unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../shared/poi-type-selection.js'
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
  | { type: 'setOpenSeaMapEnabled', enabled: boolean }
  | { type: 'setOpenSeaMapEndpoint', endpoint: string }
  | { type: 'setOpenSeaMapSeamarkGroups', groups: string[] }
  | { type: 'setOpenSeaMapDedupe', enabled: boolean }
  | { type: 'setOpenSeaMapDedupeRadius', meters: number }
  | { type: 'setUscgLightListEnabled', enabled: boolean }
  | { type: 'setUscgLightListDedupe', enabled: boolean }
  | { type: 'setUscgLightListRefreshHours', hours: number }
  | { type: 'setNoaaEncEnabled', enabled: boolean }
  | { type: 'setNoaaEncDedupe', enabled: boolean }
  | { type: 'setNoaaEncScaleBand', band: string }
  | { type: 'setNoaaEncIncludeWrecks', enabled: boolean }
  | { type: 'setNoaaEncIncludeObstructions', enabled: boolean }
  | { type: 'setNoaaEncIncludeRocks', enabled: boolean }
  | { type: 'setOpenSeaMapMinimumYear', year: number }
  | { type: 'setUscgLightListMinimumUpdateYear', year: number }
  | { type: 'setNoaaEncMinimumSurveyYear', year: number }
  | { type: 'setOpenSeaMapRefreshSeconds', seconds: number }
  | { type: 'setNoaaEncRefreshSeconds', seconds: number }
  | { type: 'discard', config: PluginConfig }

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
      if (state.cachingDurationMinutes === action.minutes) return state
      return { ...state, cachingDurationMinutes: action.minutes }
    case 'setPoiType':
      if (state[action.flag] === action.enabled) return state
      return { ...state, [action.flag]: action.enabled }
    case 'setAllPoiTypes': {
      let changed = false
      const next: PluginConfig = { ...state }
      for (const [flag] of POI_TYPE_FLAGS) {
        if (next[flag] !== action.enabled) {
          next[flag] = action.enabled
          changed = true
        }
      }
      return changed ? next : state
    }
    case 'setMinimumRating':
      if (state.minimumRating === action.rating) return state
      return { ...state, minimumRating: action.rating }
    case 'setProximityAlarmsEnabled':
      if (state.enableProximityAlarms === action.enabled) return state
      return { ...state, enableProximityAlarms: action.enabled }
    case 'setProximityAlarmRadius':
      if (state.proximityAlarmRadiusMeters === action.meters) return state
      return { ...state, proximityAlarmRadiusMeters: action.meters }
    case 'setRouteHazardScanEnabled':
      if (state.enableRouteHazardScan === action.enabled) return state
      return { ...state, enableRouteHazardScan: action.enabled }
    case 'setRouteCorridorWidth':
      if (state.routeCorridorWidthMeters === action.meters) return state
      return { ...state, routeCorridorWidthMeters: action.meters }
    case 'setOpenSeaMapEnabled':
      if (state.openSeaMapEnabled === action.enabled) return state
      return { ...state, openSeaMapEnabled: action.enabled }
    case 'setOpenSeaMapEndpoint':
      if (state.openSeaMapEndpoint === action.endpoint) return state
      return { ...state, openSeaMapEndpoint: action.endpoint }
    case 'setOpenSeaMapSeamarkGroups': {
      const current = state.openSeaMapSeamarkGroups ?? []
      if (current.length === action.groups.length &&
        current.every((group, index) => group === action.groups[index])) {
        return state
      }
      return { ...state, openSeaMapSeamarkGroups: action.groups }
    }
    case 'setOpenSeaMapDedupe':
      if (state.openSeaMapDedupe === action.enabled) return state
      return { ...state, openSeaMapDedupe: action.enabled }
    case 'setOpenSeaMapDedupeRadius':
      if (state.openSeaMapDedupeRadiusMeters === action.meters) return state
      return { ...state, openSeaMapDedupeRadiusMeters: action.meters }
    case 'setUscgLightListEnabled':
      if (state.uscgLightListEnabled === action.enabled) return state
      return { ...state, uscgLightListEnabled: action.enabled }
    case 'setUscgLightListDedupe':
      if (state.uscgLightListDedupe === action.enabled) return state
      return { ...state, uscgLightListDedupe: action.enabled }
    case 'setUscgLightListRefreshHours':
      if (state.uscgLightListRefreshHours === action.hours) return state
      return { ...state, uscgLightListRefreshHours: action.hours }
    case 'setNoaaEncEnabled':
      if (state.noaaEncEnabled === action.enabled) return state
      return { ...state, noaaEncEnabled: action.enabled }
    case 'setNoaaEncDedupe':
      if (state.noaaEncDedupe === action.enabled) return state
      return { ...state, noaaEncDedupe: action.enabled }
    case 'setNoaaEncScaleBand':
      if (state.noaaEncScaleBand === action.band) return state
      return { ...state, noaaEncScaleBand: action.band }
    case 'setNoaaEncIncludeWrecks':
      if (state.noaaEncIncludeWrecks === action.enabled) return state
      return { ...state, noaaEncIncludeWrecks: action.enabled }
    case 'setNoaaEncIncludeObstructions':
      if (state.noaaEncIncludeObstructions === action.enabled) return state
      return { ...state, noaaEncIncludeObstructions: action.enabled }
    case 'setNoaaEncIncludeRocks':
      if (state.noaaEncIncludeRocks === action.enabled) return state
      return { ...state, noaaEncIncludeRocks: action.enabled }
    case 'setOpenSeaMapMinimumYear':
      if (state.openSeaMapMinimumYear === action.year) return state
      return { ...state, openSeaMapMinimumYear: action.year }
    case 'setUscgLightListMinimumUpdateYear':
      if (state.uscgLightListMinimumUpdateYear === action.year) return state
      return { ...state, uscgLightListMinimumUpdateYear: action.year }
    case 'setNoaaEncMinimumSurveyYear':
      if (state.noaaEncMinimumSurveyYear === action.year) return state
      return { ...state, noaaEncMinimumSurveyYear: action.year }
    case 'setOpenSeaMapRefreshSeconds':
      if (state.openSeaMapRefreshSeconds === action.seconds) return state
      return { ...state, openSeaMapRefreshSeconds: action.seconds }
    case 'setNoaaEncRefreshSeconds':
      if (state.noaaEncRefreshSeconds === action.seconds) return state
      return { ...state, noaaEncRefreshSeconds: action.seconds }
  }
}
