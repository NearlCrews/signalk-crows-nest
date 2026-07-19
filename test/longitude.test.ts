import test from 'node:test'
import assert from 'node:assert/strict'
import { longitudeSpanDegrees, wrapLongitude } from '../src/shared/longitude.js'

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

test('longitudeSpanDegrees measures ordinary and wrapped intervals', () => {
  assert.equal(longitudeSpanDegrees(-10, 15), 25)
  assert.equal(longitudeSpanDegrees(170, -170), 20)
  assert.equal(longitudeSpanDegrees(-180, 180), 360)
  assert.equal(longitudeSpanDegrees(180, -180), 0)
})

test('longitudeSpanDegrees returns NaN for a non-finite edge', () => {
  assert.equal(Number.isNaN(longitudeSpanDegrees(Number.NaN, 0)), true)
  assert.equal(Number.isNaN(longitudeSpanDegrees(0, Number.POSITIVE_INFINITY)), true)
})
