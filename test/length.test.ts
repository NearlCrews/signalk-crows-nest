import test from 'node:test'
import assert from 'node:assert/strict'
import { METERS_PER_FOOT, metersFromFeet, metersFromFeetInches } from '../src/shared/length.js'

test('METERS_PER_FOOT is the exact international foot', () => {
  assert.equal(METERS_PER_FOOT, 0.3048)
})

test('metersFromFeet converts feet to meters', () => {
  assert.equal(metersFromFeet(0), 0)
  assert.equal(metersFromFeet(10), 3.048)
})

test('metersFromFeetInches folds inches into the foot conversion', () => {
  assert.equal(metersFromFeetInches(0, 12), metersFromFeet(1))
  assert.ok(Math.abs(metersFromFeetInches(10, 6) - metersFromFeet(10.5)) < 1e-12)
})
