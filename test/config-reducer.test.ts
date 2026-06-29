import test from 'node:test'
import assert from 'node:assert/strict'
import { configReducer } from '../src/panel/config-reducer.js'
import { POI_TYPE_FLAGS } from '../src/shared/poi-type-selection.js'
import type { PluginConfig } from '../src/shared/types.js'

/** A minimal config with only the required cache duration set. */
function baseConfig (): PluginConfig {
  return { cachingDurationMinutes: 60 }
}

/** A config with every POI-type flag enabled. */
function allEnabledConfig (): PluginConfig {
  return {
    ...baseConfig(),
    ...Object.fromEntries(POI_TYPE_FLAGS.map(([flag]) => [flag, true]))
  }
}

test('setCacheDuration updates the cache duration', () => {
  const next = configReducer(baseConfig(), { type: 'setCacheDuration', minutes: 120 })
  assert.equal(next.cachingDurationMinutes, 120)
})

test('setCacheDuration returns the same state when the value is unchanged', () => {
  const state = baseConfig()
  const next = configReducer(state, { type: 'setCacheDuration', minutes: 60 })
  assert.equal(next, state)
})

test('setPoiType enables a single flag', () => {
  const next = configReducer(baseConfig(), { type: 'setPoiType', flag: 'includeMarinas', enabled: true })
  assert.equal(next.includeMarinas, true)
})

test('setPoiType disables a single flag', () => {
  const state: PluginConfig = { ...baseConfig(), includeHazards: true }
  const next = configReducer(state, { type: 'setPoiType', flag: 'includeHazards', enabled: false })
  assert.equal(next.includeHazards, false)
})

test('setPoiType leaves the other flags untouched', () => {
  const state: PluginConfig = { ...baseConfig(), includeAnchorages: true }
  const next = configReducer(state, { type: 'setPoiType', flag: 'includeMarinas', enabled: true })
  assert.equal(next.includeAnchorages, true)
  assert.equal(next.includeMarinas, true)
})

test('setPoiType returns the same state when the flag is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), includeMarinas: true }
  const next = configReducer(state, { type: 'setPoiType', flag: 'includeMarinas', enabled: true })
  assert.equal(next, state)
})

test('setAllPoiTypes enables every POI flag', () => {
  const next = configReducer(baseConfig(), { type: 'setAllPoiTypes', enabled: true })
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(next[flag], true, `${flag} should be enabled`)
  }
})

test('setAllPoiTypes disables every POI flag', () => {
  const next = configReducer(allEnabledConfig(), { type: 'setAllPoiTypes', enabled: false })
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(next[flag], false, `${flag} should be disabled`)
  }
})

test('setAllPoiTypes preserves the cache duration', () => {
  const next = configReducer(baseConfig(), { type: 'setAllPoiTypes', enabled: true })
  assert.equal(next.cachingDurationMinutes, 60)
})

test('setAllPoiTypes returns the same state when nothing changes', () => {
  const state = allEnabledConfig()
  const next = configReducer(state, { type: 'setAllPoiTypes', enabled: true })
  assert.equal(next, state)
})

test('setMinimumRating updates the minimum rating', () => {
  const next = configReducer(baseConfig(), { type: 'setMinimumRating', rating: 4 })
  assert.equal(next.minimumRating, 4)
})

test('setMinimumRating returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), minimumRating: 3 }
  const next = configReducer(state, { type: 'setMinimumRating', rating: 3 })
  assert.equal(next, state)
})

test('setMinimumRating leaves the cache duration untouched', () => {
  const next = configReducer(baseConfig(), { type: 'setMinimumRating', rating: 2 })
  assert.equal(next.cachingDurationMinutes, 60)
})

test('setProximityAlarmsEnabled enables the alarms', () => {
  const next = configReducer(baseConfig(), { type: 'setProximityAlarmsEnabled', enabled: true })
  assert.equal(next.enableProximityAlarms, true)
})

test('setProximityAlarmsEnabled disables the alarms', () => {
  const state: PluginConfig = { ...baseConfig(), enableProximityAlarms: true }
  const next = configReducer(state, { type: 'setProximityAlarmsEnabled', enabled: false })
  assert.equal(next.enableProximityAlarms, false)
})

test('setProximityAlarmsEnabled returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), enableProximityAlarms: true }
  const next = configReducer(state, { type: 'setProximityAlarmsEnabled', enabled: true })
  assert.equal(next, state)
})

test('setProximityAlarmRadius updates the radius', () => {
  const next = configReducer(baseConfig(), { type: 'setProximityAlarmRadius', meters: 250 })
  assert.equal(next.proximityAlarmRadiusMeters, 250)
})

test('setProximityAlarmRadius returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), proximityAlarmRadiusMeters: 500 }
  const next = configReducer(state, { type: 'setProximityAlarmRadius', meters: 500 })
  assert.equal(next, state)
})

test('setOpenSeaMapEnabled enables the OpenSeaMap source', () => {
  const next = configReducer(baseConfig(), { type: 'setOpenSeaMapEnabled', enabled: true })
  assert.equal(next.openSeaMapEnabled, true)
})

test('setOpenSeaMapEnabled returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), openSeaMapEnabled: true }
  const next = configReducer(state, { type: 'setOpenSeaMapEnabled', enabled: true })
  assert.equal(next, state)
})

test('setOpenSeaMapEndpoint updates the endpoint URL', () => {
  const next = configReducer(baseConfig(), {
    type: 'setOpenSeaMapEndpoint',
    endpoint: 'https://overpass.example/api'
  })
  assert.equal(next.openSeaMapEndpoint, 'https://overpass.example/api')
})

test('setOpenSeaMapEndpoint returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), openSeaMapEndpoint: 'https://overpass.example/api' }
  const next = configReducer(state, { type: 'setOpenSeaMapEndpoint', endpoint: 'https://overpass.example/api' })
  assert.equal(next, state)
})

test('setOpenSeaMapSeamarkGroups updates the seamark groups', () => {
  const next = configReducer(baseConfig(), {
    type: 'setOpenSeaMapSeamarkGroups',
    groups: ['hazards', 'navaids']
  })
  assert.deepEqual(next.openSeaMapSeamarkGroups, ['hazards', 'navaids'])
})

test('setOpenSeaMapSeamarkGroups returns the same state when the groups are unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), openSeaMapSeamarkGroups: ['hazards', 'navaids'] }
  const next = configReducer(state, {
    type: 'setOpenSeaMapSeamarkGroups',
    groups: ['hazards', 'navaids']
  })
  assert.equal(next, state)
})

test('setRouteHazardScanEnabled enables the route-hazard scan', () => {
  const next = configReducer(baseConfig(), { type: 'setRouteHazardScanEnabled', enabled: true })
  assert.equal(next.enableRouteHazardScan, true)
})

test('setRouteHazardScanEnabled disables the route-hazard scan', () => {
  const state: PluginConfig = { ...baseConfig(), enableRouteHazardScan: true }
  const next = configReducer(state, { type: 'setRouteHazardScanEnabled', enabled: false })
  assert.equal(next.enableRouteHazardScan, false)
})

test('setRouteHazardScanEnabled returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), enableRouteHazardScan: true }
  const next = configReducer(state, { type: 'setRouteHazardScanEnabled', enabled: true })
  assert.equal(next, state)
})

test('setRouteCorridorWidth updates the corridor width', () => {
  const next = configReducer(baseConfig(), { type: 'setRouteCorridorWidth', meters: 750 })
  assert.equal(next.routeCorridorWidthMeters, 750)
})

test('setRouteCorridorWidth returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), routeCorridorWidthMeters: 500 }
  const next = configReducer(state, { type: 'setRouteCorridorWidth', meters: 500 })
  assert.equal(next, state)
})

test('setBridgeAirDraftCheckEnabled enables the bridge air-draft check', () => {
  const next = configReducer(baseConfig(), { type: 'setBridgeAirDraftCheckEnabled', enabled: true })
  assert.equal(next.enableBridgeAirDraftCheck, true)
})

test('setBridgeAirDraftCheckEnabled disables the bridge air-draft check', () => {
  const state: PluginConfig = { ...baseConfig(), enableBridgeAirDraftCheck: true }
  const next = configReducer(state, { type: 'setBridgeAirDraftCheckEnabled', enabled: false })
  assert.equal(next.enableBridgeAirDraftCheck, false)
})

test('setBridgeAirDraftCheckEnabled returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), enableBridgeAirDraftCheck: true }
  const next = configReducer(state, { type: 'setBridgeAirDraftCheckEnabled', enabled: true })
  assert.equal(next, state)
})

test('setVesselAirDraft updates the air draft', () => {
  const next = configReducer(baseConfig(), { type: 'setVesselAirDraft', meters: 4.5 })
  assert.equal(next.vesselAirDraftMeters, 4.5)
})

test('setVesselAirDraft returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), vesselAirDraftMeters: 4.5 }
  const next = configReducer(state, { type: 'setVesselAirDraft', meters: 4.5 })
  assert.equal(next, state)
})

test('setBridgeClearanceMargin updates the margin', () => {
  const next = configReducer(baseConfig(), { type: 'setBridgeClearanceMargin', meters: 2 })
  assert.equal(next.bridgeClearanceMarginMeters, 2)
})

test('setBridgeClearanceMargin returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), bridgeClearanceMarginMeters: 1 }
  const next = configReducer(state, { type: 'setBridgeClearanceMargin', meters: 1 })
  assert.equal(next, state)
})

test('setOpenSeaMapDedupe enables the dedupe pass', () => {
  const next = configReducer(baseConfig(), { type: 'setOpenSeaMapDedupe', enabled: true })
  assert.equal(next.openSeaMapDedupe, true)
})

test('setOpenSeaMapDedupe disables the dedupe pass', () => {
  const state: PluginConfig = { ...baseConfig(), openSeaMapDedupe: true }
  const next = configReducer(state, { type: 'setOpenSeaMapDedupe', enabled: false })
  assert.equal(next.openSeaMapDedupe, false)
})

test('setOpenSeaMapDedupe returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), openSeaMapDedupe: false }
  const next = configReducer(state, { type: 'setOpenSeaMapDedupe', enabled: false })
  assert.equal(next, state)
})

test('setOpenSeaMapDedupeRadius updates the dedupe merge radius', () => {
  const next = configReducer(baseConfig(), { type: 'setOpenSeaMapDedupeRadius', meters: 200 })
  assert.equal(next.openSeaMapDedupeRadiusMeters, 200)
})

test('setOpenSeaMapDedupeRadius returns the same state when the value is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), openSeaMapDedupeRadiusMeters: 150 }
  const next = configReducer(state, { type: 'setOpenSeaMapDedupeRadius', meters: 150 })
  assert.equal(next, state)
})

test('setUscgLightListEnabled toggles the source', () => {
  const next = configReducer(baseConfig(), { type: 'setUscgLightListEnabled', enabled: true })
  assert.equal(next.uscgLightListEnabled, true)
})

test('setUscgLightListDedupe toggles the dedupe pass', () => {
  const next = configReducer(baseConfig(), { type: 'setUscgLightListDedupe', enabled: false })
  assert.equal(next.uscgLightListDedupe, false)
})

test('setUscgLightListRefreshHours updates the refresh period', () => {
  const next = configReducer(baseConfig(), { type: 'setUscgLightListRefreshHours', hours: 24 })
  assert.equal(next.uscgLightListRefreshHours, 24)
})

test('setNoaaEncEnabled toggles the source', () => {
  const next = configReducer(baseConfig(), { type: 'setNoaaEncEnabled', enabled: true })
  assert.equal(next.noaaEncEnabled, true)
})

test('setNoaaEncDedupe toggles the dedupe pass', () => {
  const next = configReducer(baseConfig(), { type: 'setNoaaEncDedupe', enabled: false })
  assert.equal(next.noaaEncDedupe, false)
})

test('setNoaaEncScaleBand updates the scale band', () => {
  const next = configReducer(baseConfig(), { type: 'setNoaaEncScaleBand', band: 'harbour' })
  assert.equal(next.noaaEncScaleBand, 'harbour')
})

test('setNoaaEncIncludeWrecks toggles the wrecks layer', () => {
  const next = configReducer(baseConfig(), { type: 'setNoaaEncIncludeWrecks', enabled: false })
  assert.equal(next.noaaEncIncludeWrecks, false)
})

test('setNoaaEncIncludeObstructions toggles the obstructions layer', () => {
  const next = configReducer(baseConfig(), { type: 'setNoaaEncIncludeObstructions', enabled: false })
  assert.equal(next.noaaEncIncludeObstructions, false)
})

test('setNoaaEncIncludeRocks toggles the rocks layer', () => {
  const next = configReducer(baseConfig(), { type: 'setNoaaEncIncludeRocks', enabled: true })
  assert.equal(next.noaaEncIncludeRocks, true)
})

test('discard returns the supplied configuration', () => {
  const edited: PluginConfig = { ...baseConfig(), cachingDurationMinutes: 999, includeMarinas: true }
  const saved: PluginConfig = { ...baseConfig(), includeAnchorages: true }
  const next = configReducer(edited, { type: 'discard', config: saved })
  assert.equal(next, saved)
})
