import test from 'node:test'
import assert from 'node:assert/strict'
import {
  coveredChordMeters,
  deriveScanCadence,
  SMALLEST_COVERED_RADIUS_METERS
} from '../src/monitoring/scan-cadence.js'
import type { PositionScanContributor } from '../src/outputs/output.js'
import { METERS_PER_NAUTICAL_MILE } from '../src/shared/length.js'
import { SECONDS_PER_HOUR } from '../src/shared/time.js'

/** A scan contributor that declares (or omits) an alarm radius. */
function contributor (alarmRadiusMeters?: number): PositionScanContributor {
  return {
    poiTypes: ['Hazard'],
    alarmRadiusMeters,
    buildFetchBox: () => null,
    evaluate: () => {}
  }
}

/** The knots a speed in meters per second works out to. */
function knots (metersPerSecond: number): number {
  return metersPerSecond * SECONDS_PER_HOUR / METERS_PER_NAUTICAL_MILE
}

test('the covered chord is the along-track width of the alarm zone', () => {
  // A point 0.8 of the radius off the track crosses a chord of
  // 2 * r * sqrt(1 - 0.8^2) = 1.2 * r.
  assert.ok(Math.abs(coveredChordMeters(500) - 600) < 1e-9)
  assert.ok(Math.abs(coveredChordMeters(100) - 120) < 1e-9)
})

test('no declared radius leaves every gate open', () => {
  const cadence = deriveScanCadence([contributor(), contributor()])

  assert.equal(cadence.tightestRadiusMeters, undefined)
  assert.equal(cadence.coverageMoveMeters, Infinity)
  assert.equal(cadence.coveredChordMeters, Infinity)
  assert.equal(cadence.maxCoveredSpeedMps, Infinity)
})

test('the tightest declared radius sets the cadence', () => {
  const cadence = deriveScanCadence([contributor(500), contributor(120), contributor()])

  assert.equal(cadence.tightestRadiusMeters, 120)
  assert.equal(cadence.coveredChordMeters, coveredChordMeters(120))
})

test('the default alarm radius is covered well past any vessel speed', () => {
  const cadence = deriveScanCadence([contributor(500)])

  assert.ok(knots(cadence.maxCoveredSpeedMps) > 500, 'covered far beyond any hull speed')
  // The fetch box is 2000 m around the tick position for a 500 m radius, so
  // the vessel may run 1500 m from it before the box stops reaching the zone.
  assert.ok(Math.abs(cadence.coverageMoveMeters - 1500) < 1e-9)
})

test('a tight alarm radius samples finely and states a lower covered speed', () => {
  const cadence = deriveScanCadence([contributor(20)])

  assert.equal(cadence.evaluationMoveMeters, coveredChordMeters(20) / 2)
  // 1.2 * 20 m/s, about 47 kn: a planing boat can outrun a 20 m alarm zone.
  assert.ok(Math.abs(knots(cadence.maxCoveredSpeedMps) - 46.7) < 0.5)
})

test('a radius the sampling cannot resolve reports no covered speed at all', () => {
  const cadence = deriveScanCadence([contributor(1)])

  assert.equal(cadence.maxCoveredSpeedMps, 0, 'not honorable at any speed')
  assert.ok(cadence.evaluationMoveMeters > cadence.coveredChordMeters)
  assert.ok(SMALLEST_COVERED_RADIUS_METERS > 1)
  assert.equal(deriveScanCadence([contributor(500)]).maxCoveredSpeedMps > 0, true)
})

test('the smallest covered radius is the one where the distance floor stops binding', () => {
  const smallest = SMALLEST_COVERED_RADIUS_METERS

  assert.ok(deriveScanCadence([contributor(smallest * 1.01)]).maxCoveredSpeedMps > 0)
  assert.equal(deriveScanCadence([contributor(smallest * 0.99)]).maxCoveredSpeedMps, 0)
})

test('a nonsense declared radius is ignored rather than driving the cadence', () => {
  const cadence = deriveScanCadence([contributor(Number.NaN), contributor(-5), contributor(500)])

  assert.equal(cadence.tightestRadiusMeters, 500)
})
