import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_HEAD_SEA_DERATE,
  estimateFuel,
  routeDistanceMeters,
  type FuelEstimate,
  type FuelParams
} from '../src/route-draft/fuel.js'
import { rhumbDistanceMeters } from '../src/geo/position-utilities.js'
import type { Position } from '../src/shared/types.js'
import { METERS_PER_NAUTICAL_MILE } from '../src/shared/length.js'

/** A power-vessel baseline: 100 nm at 10 kn burning 4 L/h. */
function powerParams (overrides: Partial<FuelParams> = {}): FuelParams {
  return {
    routeDistanceMeters: 100 * METERS_PER_NAUTICAL_MILE,
    propulsion: 'power',
    cruiseSpeedKn: 10,
    burnAtCruise: 4,
    reservePercent: 20,
    fuelAboardLiters: 80,
    ...overrides
  }
}

/** Narrow the union return to an estimate, failing the test when it is a reason. */
function expectEstimate (result: FuelEstimate | { reason: string }): FuelEstimate {
  assert.ok(!('reason' in result), `expected an estimate, got reason ${('reason' in result) ? result.reason : ''}`)
  return result
}

test('estimateFuel computes need and margin for a power vessel against a hand-worked number', () => {
  // 100 nm at 10 kn burning 4 L/h: 0.4 L/nm, 40 L base, 50 L after the flat 25
  // percent derate. Aboard 80 L less a 20 percent reserve is 64 L usable, so the
  // margin is (64 - 50) / 50 = 28 percent.
  const estimate = expectEstimate(estimateFuel(powerParams()))

  assert.equal(estimate.neededL, 50, 'needed fuel is 40 L times the 1.25 derate')
  assert.equal(estimate.aboardL, 80, 'fuel aboard is echoed')
  assert.equal(estimate.marginPct, 28, 'estimated margin is 28 percent of need')
  assert.equal(estimate.derateNote, 'assumes a flat 25 percent head-sea derate', 'the flat derate is stated')
})

test('estimateFuel applies the flat head-sea derate as a stated multiplier', () => {
  // The same 40 L base scales by (1 + derate): no derate is 40 L, half is 60 L,
  // and the note restates the factor each time.
  const noDerate = expectEstimate(estimateFuel(powerParams({ headSeaDerate: 0 })))
  assert.equal(noDerate.neededL, 40, 'a zero derate leaves the base 40 L')
  assert.equal(noDerate.derateNote, 'assumes a flat 0 percent head-sea derate', 'a zero derate is still stated')

  const heavyDerate = expectEstimate(estimateFuel(powerParams({ headSeaDerate: 0.5 })))
  assert.equal(heavyDerate.neededL, 60, 'a 50 percent derate budgets 60 L for the same 40 L base')
  assert.equal(heavyDerate.derateNote, 'assumes a flat 50 percent head-sea derate', 'the heavier derate is stated')

  // The default is the documented flat assumption, not zero.
  assert.equal(DEFAULT_HEAD_SEA_DERATE, 0.25, 'the default derate is a flat 25 percent')
})

test('estimateFuel does not fabricate fuel for a sail vessel without a motoring fraction', () => {
  const result = estimateFuel(powerParams({ propulsion: 'sail' }))

  assert.deepEqual(result, { reason: 'sail-no-motoring-fraction' }, 'sail with no motoring fraction is an honest non-estimate')
})

test('estimateFuel estimates a sail vessel only against a given motoring fraction', () => {
  // With half the passage under power the 40 L base halves to 20 L, then the
  // flat derate brings it to 25 L. The estimate is honest because the fraction
  // was supplied, not assumed.
  const estimate = expectEstimate(estimateFuel(powerParams({ propulsion: 'sail', motoringFraction: 0.5 })))

  assert.equal(estimate.neededL, 25, 'half-motoring halves the base before the derate')
})

test('estimateFuel states the full-motoring assumption for a motorsailer without a fraction', () => {
  const estimate = expectEstimate(estimateFuel(powerParams({ propulsion: 'motorsail' })))

  // motorsail with no fraction motors fully, the same 50 L as the power case,
  // but the note must say so rather than presenting a sail-aware figure.
  assert.equal(estimate.neededL, 50, 'a motorsailer with no fraction is estimated as fully under power')
  assert.match(estimate.derateNote, /assumes full motoring \(no motoring fraction set\)/, 'the motoring assumption is stated')
})

test('estimateFuel degrades to a reason when burn or cruise speed is missing or zero', () => {
  assert.deepEqual(estimateFuel(powerParams({ burnAtCruise: 0 })), { reason: 'no-burn-rate' }, 'a zero burn is no estimate')
  assert.deepEqual(
    estimateFuel(powerParams({ burnAtCruise: undefined as unknown as number })),
    { reason: 'no-burn-rate' },
    'a missing burn is no estimate'
  )
  assert.deepEqual(estimateFuel(powerParams({ cruiseSpeedKn: 0 })), { reason: 'no-cruise-speed' }, 'a zero cruise speed is no estimate')
  assert.deepEqual(
    estimateFuel(powerParams({ cruiseSpeedKn: undefined as unknown as number })),
    { reason: 'no-cruise-speed' },
    'a missing cruise speed is no estimate'
  )
})

test('estimateFuel omits the margin when no fuel aboard is supplied', () => {
  const estimate = expectEstimate(estimateFuel(powerParams({ fuelAboardLiters: undefined })))

  assert.equal(estimate.neededL, 50, 'need is computed without fuel aboard')
  assert.equal(estimate.aboardL, undefined, 'no fuel aboard is echoed')
  assert.equal(estimate.marginPct, undefined, 'no margin is reported without fuel aboard')
})

test('routeDistanceMeters sums the rhumb-line legs of a multi-leg route', () => {
  const waypoints: Position[] = [
    { latitude: 40, longitude: -70 },
    { latitude: 41, longitude: -69 },
    { latitude: 40.5, longitude: -68 }
  ]
  const expected =
    rhumbDistanceMeters(waypoints[0], waypoints[1]) +
    rhumbDistanceMeters(waypoints[1], waypoints[2])

  assert.ok(Math.abs(routeDistanceMeters(waypoints) - expected) < 1e-6, 'the total is the sum of the leg rhumb distances')
})

test('routeDistanceMeters is zero for a route with fewer than two waypoints', () => {
  assert.equal(routeDistanceMeters([]), 0, 'an empty route has no distance')
  assert.equal(routeDistanceMeters([{ latitude: 40, longitude: -70 }]), 0, 'a single point has no leg')
})
