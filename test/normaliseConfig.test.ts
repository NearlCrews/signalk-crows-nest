import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CACHE_DURATION_MINUTES,
  DEFAULT_MINIMUM_RATING,
  DEFAULT_PROXIMITY_ALARM_RADIUS_METERS,
  normalizeConfig
} from '../src/panel/normaliseConfig.js'
import { POI_TYPE_FLAGS } from '../src/shared/poi-type-selection.js'

test('normalizeConfig fills every POI flag true and the default duration for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(config[flag], true, `${flag} defaults to true`)
  }
})

test('normalizeConfig keeps a valid cache duration', () => {
  assert.equal(normalizeConfig({ cachingDurationMinutes: 15 }).cachingDurationMinutes, 15)
})

test('normalizeConfig falls back to the default for an unusable cache duration', () => {
  assert.equal(normalizeConfig({ cachingDurationMinutes: 0 }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  assert.equal(normalizeConfig({ cachingDurationMinutes: -5 }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  assert.equal(normalizeConfig({ cachingDurationMinutes: 'soon' }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
})

test('normalizeConfig preserves an explicitly disabled POI flag', () => {
  const config = normalizeConfig({ includeMarinas: false, includeHazards: true })
  assert.equal(config.includeMarinas, false)
  assert.equal(config.includeHazards, true)
  assert.equal(config.includeAnchorages, true, 'an absent flag still defaults to true')
})

test('normalizeConfig treats a non-object configuration as empty', () => {
  for (const input of [null, undefined, 'config', 42]) {
    const config = normalizeConfig(input)
    assert.equal(config.cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
    assert.equal(config.includeMarinas, true)
  }
})

test('normalizeConfig defaults the safety options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.minimumRating, DEFAULT_MINIMUM_RATING)
  assert.equal(config.enableProximityAlarms, false)
  assert.equal(config.proximityAlarmRadiusMeters, DEFAULT_PROXIMITY_ALARM_RADIUS_METERS)
})

test('normalizeConfig keeps valid safety options', () => {
  const config = normalizeConfig({
    minimumRating: 3,
    enableProximityAlarms: true,
    proximityAlarmRadiusMeters: 250
  })
  assert.equal(config.minimumRating, 3)
  assert.equal(config.enableProximityAlarms, true)
  assert.equal(config.proximityAlarmRadiusMeters, 250)
})

test('normalizeConfig clamps an out-of-range minimum rating', () => {
  assert.equal(normalizeConfig({ minimumRating: 9 }).minimumRating, 5)
  assert.equal(normalizeConfig({ minimumRating: -2 }).minimumRating, 0)
})

test('normalizeConfig falls back to the default for an unusable minimum rating', () => {
  assert.equal(normalizeConfig({ minimumRating: 'high' }).minimumRating, DEFAULT_MINIMUM_RATING)
  assert.equal(normalizeConfig({ minimumRating: Number.NaN }).minimumRating, DEFAULT_MINIMUM_RATING)
})

test('normalizeConfig treats a non-true enableProximityAlarms as false', () => {
  assert.equal(normalizeConfig({ enableProximityAlarms: 'yes' }).enableProximityAlarms, false)
  assert.equal(normalizeConfig({ enableProximityAlarms: false }).enableProximityAlarms, false)
})

test('normalizeConfig falls back to the default for an unusable alarm radius', () => {
  assert.equal(
    normalizeConfig({ proximityAlarmRadiusMeters: -10 }).proximityAlarmRadiusMeters,
    DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
  )
  assert.equal(
    normalizeConfig({ proximityAlarmRadiusMeters: 'far' }).proximityAlarmRadiusMeters,
    DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
  )
})

test('normalizeConfig falls back to the default for a zero alarm radius', () => {
  assert.equal(
    normalizeConfig({ proximityAlarmRadiusMeters: 0 }).proximityAlarmRadiusMeters,
    DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
  )
})
