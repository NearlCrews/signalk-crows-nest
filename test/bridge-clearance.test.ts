import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CLEARANCE_MARGIN_METERS,
  MAX_CLEARANCE_MARGIN_METERS,
  MIN_CLEARANCE_MARGIN_METERS,
  bridgeBlocksVessel,
  clampClearanceMargin,
  readVesselAirDraft,
  type AirDraftApp
} from '../src/shared/bridge-clearance.js'

/** A minimal AirDraftApp whose getSelfPath returns a fixed value (or throws). */
function app (selfValue: unknown, opts: { throws?: boolean } = {}): AirDraftApp {
  return {
    getSelfPath: () => {
      if (opts.throws === true) throw new Error('no data model')
      return selfValue
    },
    debug: () => {}
  }
}

test('clampClearanceMargin keeps an in-range value and bounds the rest', () => {
  assert.equal(clampClearanceMargin(2.5), 2.5)
  assert.equal(clampClearanceMargin(MIN_CLEARANCE_MARGIN_METERS - 5), MIN_CLEARANCE_MARGIN_METERS)
  assert.equal(clampClearanceMargin(MAX_CLEARANCE_MARGIN_METERS + 5), MAX_CLEARANCE_MARGIN_METERS)
})

test('clampClearanceMargin falls back to the default on a non-finite value', () => {
  assert.equal(clampClearanceMargin('3' as unknown), DEFAULT_CLEARANCE_MARGIN_METERS)
  assert.equal(clampClearanceMargin(Number.NaN), DEFAULT_CLEARANCE_MARGIN_METERS)
  assert.equal(clampClearanceMargin(Number.POSITIVE_INFINITY), DEFAULT_CLEARANCE_MARGIN_METERS)
  assert.equal(clampClearanceMargin(undefined), DEFAULT_CLEARANCE_MARGIN_METERS)
})

test('readVesselAirDraft reads design.airHeight as a bare meters value', () => {
  assert.equal(readVesselAirDraft(app(4.2)), 4.2)
})

test('readVesselAirDraft unwraps a { value } wrapper from the data model', () => {
  assert.equal(readVesselAirDraft(app({ value: 5.5 })), 5.5)
})

test('readVesselAirDraft falls back to the config value when design.airHeight is absent', () => {
  assert.equal(readVesselAirDraft(app(undefined), 3.1), 3.1)
  assert.equal(readVesselAirDraft(app(null), 3.1), 3.1)
})

test('readVesselAirDraft prefers a positive design.airHeight over the fallback', () => {
  assert.equal(readVesselAirDraft(app(6), 3.1), 6)
})

test('readVesselAirDraft ignores a non-positive design.airHeight and uses the fallback', () => {
  assert.equal(readVesselAirDraft(app(0), 3.1), 3.1)
  assert.equal(readVesselAirDraft(app(-2), 3.1), 3.1)
})

test('readVesselAirDraft returns null when neither source yields a usable value', () => {
  assert.equal(readVesselAirDraft(app(undefined)), null)
  assert.equal(readVesselAirDraft(app(undefined), 0), null)
  assert.equal(readVesselAirDraft(app(undefined), -1), null)
})

test('readVesselAirDraft survives a throwing getSelfPath and uses the fallback', () => {
  assert.equal(readVesselAirDraft(app(undefined, { throws: true }), 2.4), 2.4)
  assert.equal(readVesselAirDraft(app(undefined, { throws: true })), null)
})

test('bridgeBlocksVessel warns when clearance is below air draft plus margin', () => {
  // air draft 4, margin 1 => warns at or below 5 m of clearance.
  assert.equal(bridgeBlocksVessel(4.9, 4, 1), true)
  assert.equal(bridgeBlocksVessel(5, 4, 1), true, 'exact equality warns')
  assert.equal(bridgeBlocksVessel(5.1, 4, 1), false)
})

test('bridgeBlocksVessel with a zero margin is a strict comparison', () => {
  assert.equal(bridgeBlocksVessel(4, 4, 0), true)
  assert.equal(bridgeBlocksVessel(4.01, 4, 0), false)
})

test('bridgeBlocksVessel never warns on an unknown clearance or air draft', () => {
  assert.equal(bridgeBlocksVessel(null, 4, 1), false)
  assert.equal(bridgeBlocksVessel(undefined, 4, 1), false)
  assert.equal(bridgeBlocksVessel(3, null, 1), false)
  assert.equal(bridgeBlocksVessel(Number.NaN, 4, 1), false)
})

test('bridgeBlocksVessel treats a non-finite margin as the default margin', () => {
  // default margin is 1, so a 5 m clearance under a 4 m air draft warns.
  assert.equal(bridgeBlocksVessel(5, 4, Number.NaN), true)
  assert.equal(bridgeBlocksVessel(5.5, 4, Number.NaN), false)
})
