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

test('discard returns the supplied configuration', () => {
  const edited: PluginConfig = { ...baseConfig(), cachingDurationMinutes: 999, includeMarinas: true }
  const saved: PluginConfig = { ...baseConfig(), includeAnchorages: true }
  const next = configReducer(edited, { type: 'discard', config: saved })
  assert.equal(next, saved)
})
