import test from 'node:test'
import assert from 'node:assert/strict'
import { wrapLongitude } from '../src/shared/longitude.js'

test('wrapLongitude preserves in-range values and wraps across the antimeridian', () => {
  assert.equal(wrapLongitude(-180), -180)
  assert.equal(wrapLongitude(180), 180)
  assert.equal(wrapLongitude(181), -179)
  assert.equal(wrapLongitude(-181), 179)
  assert.equal(wrapLongitude(540), 180)
})

test('wrapLongitude returns NaN for non-finite input without looping', () => {
  assert.equal(Number.isNaN(wrapLongitude(Number.NaN)), true)
  assert.equal(Number.isNaN(wrapLongitude(Number.POSITIVE_INFINITY)), true)
})
