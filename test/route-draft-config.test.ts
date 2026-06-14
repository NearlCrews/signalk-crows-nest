/**
 * Tests for the route-draft config contract: the schema fragment shape and the
 * normalize-and-clamp coercion. The clamps are the load-bearing logic, since
 * they keep an out-of-range or garbled stored value from reaching the runtime
 * and keep the schema bounds and the panel bounds reading the one set of values.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BURN_LITERS_PER_HOUR,
  DEFAULT_CRUISE_SPEED_KN,
  DEFAULT_MAX_CALLS_PER_DAY,
  DEFAULT_MAX_LEG_NM,
  DEFAULT_PROPULSION,
  DEFAULT_RESERVE_PERCENT,
  DEFAULT_ROUTE_DRAFT_MODEL,
  DEFAULT_SAFETY_MARGIN_METERS,
  DEFAULT_STANDOFF_NM,
  DEFAULT_TACKING_ANGLE_DEG,
  MAX_DRAFT_METERS,
  MAX_MAX_CALLS_PER_DAY,
  MAX_RESERVE_PERCENT,
  MIN_CRUISE_SPEED_KN,
  MIN_MAX_CALLS_PER_DAY,
  normalizeRouteDraftConfig,
  resolvePropulsion,
  routeDraftConfigSchema
} from '../src/route-draft/config.js'

test('an empty config normalizes to the documented defaults', () => {
  const config = normalizeRouteDraftConfig({})
  assert.equal(config.routeDraftEnabled, false, 'the master toggle defaults off')
  assert.equal(config.routeDraftOpenRouterApiKey, '', 'no key by default')
  assert.equal(config.routeDraftModel, DEFAULT_ROUTE_DRAFT_MODEL)
  assert.equal(config.routeDraftMaxCallsPerDay, DEFAULT_MAX_CALLS_PER_DAY)
  assert.equal(config.routeDraftPropulsion, DEFAULT_PROPULSION)
  assert.equal(config.routeDraftSafetyMarginMeters, DEFAULT_SAFETY_MARGIN_METERS)
  assert.equal(config.routeDraftTackingAngleDeg, DEFAULT_TACKING_ANGLE_DEG)
  assert.equal(config.routeDraftCruiseSpeedKn, DEFAULT_CRUISE_SPEED_KN)
  assert.equal(config.routeDraftBurnLitersPerHour, DEFAULT_BURN_LITERS_PER_HOUR)
  assert.equal(config.routeDraftReservePercent, DEFAULT_RESERVE_PERCENT)
  assert.equal(config.routeDraftStandoffNm, DEFAULT_STANDOFF_NM)
  assert.equal(config.routeDraftMaxLegNm, DEFAULT_MAX_LEG_NM)
})

test('a non-object config normalizes to defaults rather than throwing', () => {
  for (const raw of [null, undefined, 7, 'nope', []]) {
    const config = normalizeRouteDraftConfig(raw)
    assert.equal(config.routeDraftEnabled, false)
    assert.equal(config.routeDraftModel, DEFAULT_ROUTE_DRAFT_MODEL)
  }
})

test('out-of-range numeric values clamp to the nearest bound', () => {
  const high = normalizeRouteDraftConfig({
    routeDraftMaxCallsPerDay: 10_000,
    routeDraftDraftMeters: 999,
    routeDraftReservePercent: 250
  })
  assert.equal(high.routeDraftMaxCallsPerDay, MAX_MAX_CALLS_PER_DAY, 'the call cap clamps to its ceiling')
  assert.equal(high.routeDraftDraftMeters, MAX_DRAFT_METERS, 'the draft clamps to its ceiling')
  assert.equal(high.routeDraftReservePercent, MAX_RESERVE_PERCENT, 'the reserve clamps to its ceiling')

  const low = normalizeRouteDraftConfig({
    routeDraftMaxCallsPerDay: 0,
    routeDraftCruiseSpeedKn: -5
  })
  assert.equal(low.routeDraftMaxCallsPerDay, MIN_MAX_CALLS_PER_DAY, 'the call cap clamps to its floor')
  assert.equal(low.routeDraftCruiseSpeedKn, MIN_CRUISE_SPEED_KN, 'a negative cruise speed clamps to its floor')
})

test('a non-numeric numeric value falls back to its default', () => {
  const config = normalizeRouteDraftConfig({
    routeDraftMaxCallsPerDay: 'lots',
    routeDraftStandoffNm: null,
    routeDraftTackingAngleDeg: Number.NaN
  })
  assert.equal(config.routeDraftMaxCallsPerDay, DEFAULT_MAX_CALLS_PER_DAY)
  assert.equal(config.routeDraftStandoffNm, DEFAULT_STANDOFF_NM)
  assert.equal(config.routeDraftTackingAngleDeg, DEFAULT_TACKING_ANGLE_DEG)
})

test('the call cap truncates a fractional value to an integer', () => {
  const config = normalizeRouteDraftConfig({ routeDraftMaxCallsPerDay: 12.9 })
  assert.equal(config.routeDraftMaxCallsPerDay, 12, 'the integer call cap is truncated, not rounded')
})

test('a blank or non-string model falls back to the default slug', () => {
  assert.equal(normalizeRouteDraftConfig({ routeDraftModel: '   ' }).routeDraftModel, DEFAULT_ROUTE_DRAFT_MODEL)
  assert.equal(normalizeRouteDraftConfig({ routeDraftModel: 42 }).routeDraftModel, DEFAULT_ROUTE_DRAFT_MODEL)
  assert.equal(
    normalizeRouteDraftConfig({ routeDraftModel: 'anthropic/claude-3.5-sonnet' }).routeDraftModel,
    'anthropic/claude-3.5-sonnet',
    'an explicit slug is kept'
  )
})

test('resolvePropulsion keeps a known value and defaults an unknown one', () => {
  assert.equal(resolvePropulsion('sail'), 'sail')
  assert.equal(resolvePropulsion('motorsail'), 'motorsail')
  assert.equal(resolvePropulsion('power'), 'power')
  assert.equal(resolvePropulsion('rowing'), DEFAULT_PROPULSION, 'an unknown kind defaults')
  assert.equal(resolvePropulsion(undefined), DEFAULT_PROPULSION)
})

test('the schema fragment carries every namespaced key once', () => {
  const schema = routeDraftConfigSchema()
  const keys = Object.keys(schema)
  const expected = [
    'routeDraftEnabled',
    'routeDraftOpenRouterApiKey',
    'routeDraftModel',
    'routeDraftMaxCallsPerDay',
    'routeDraftPropulsion',
    'routeDraftDraftMeters',
    'routeDraftSafetyMarginMeters',
    'routeDraftTackingAngleDeg',
    'routeDraftCruiseSpeedKn',
    'routeDraftBurnLitersPerHour',
    'routeDraftReservePercent',
    'routeDraftStandoffNm',
    'routeDraftMaxLegNm'
  ]
  assert.deepEqual(keys.sort(), [...expected].sort(), 'the fragment declares exactly the documented keys')
  assert.ok(keys.every((key) => key.startsWith('routeDraft')), 'every key is namespaced so it cannot collide')
})

test('the schema fragment bounds match the clamp bounds', () => {
  const schema = routeDraftConfigSchema() as Record<string, { default?: unknown, minimum?: unknown, maximum?: unknown }>
  // A value above a field's schema maximum must clamp to that same maximum, so
  // the form and the schema cannot present different ceilings.
  assert.equal(schema.routeDraftMaxCallsPerDay.maximum, MAX_MAX_CALLS_PER_DAY)
  assert.equal(schema.routeDraftMaxCallsPerDay.minimum, MIN_MAX_CALLS_PER_DAY)
  assert.equal(schema.routeDraftReservePercent.maximum, MAX_RESERVE_PERCENT)
  assert.equal(schema.routeDraftEnabled.default, false)
})
