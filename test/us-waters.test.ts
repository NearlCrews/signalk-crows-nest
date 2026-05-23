import test from 'node:test'
import assert from 'node:assert/strict'
import { isInUsWaters } from '../src/shared/us-waters.js'

test('isInUsWaters returns true for CONUS coastal positions', () => {
  // Boston Harbor
  assert.equal(isInUsWaters({ latitude: 42.36, longitude: -71.05 }), true)
  // San Francisco Bay
  assert.equal(isInUsWaters({ latitude: 37.78, longitude: -122.42 }), true)
  // Gulf of Mexico, off Galveston
  assert.equal(isInUsWaters({ latitude: 29.30, longitude: -94.79 }), true)
})

test('isInUsWaters returns true for Great Lakes positions', () => {
  // Lake Michigan, mid-lake
  assert.equal(isInUsWaters({ latitude: 43.50, longitude: -87.00 }), true)
  // Lake St. Clair
  assert.equal(isInUsWaters({ latitude: 42.45, longitude: -82.66 }), true)
})

test('isInUsWaters returns true for Alaska, Hawaii, and US territories', () => {
  // Juneau
  assert.equal(isInUsWaters({ latitude: 58.30, longitude: -134.42 }), true)
  // Honolulu
  assert.equal(isInUsWaters({ latitude: 21.31, longitude: -157.86 }), true)
  // San Juan, Puerto Rico
  assert.equal(isInUsWaters({ latitude: 18.47, longitude: -66.12 }), true)
  // Guam
  assert.equal(isInUsWaters({ latitude: 13.44, longitude: 144.79 }), true)
})

test('isInUsWaters returns false for clearly non-US positions', () => {
  // Mediterranean, off Barcelona
  assert.equal(isInUsWaters({ latitude: 41.38, longitude: 2.18 }), false)
  // English Channel, off Dover
  assert.equal(isInUsWaters({ latitude: 51.13, longitude: 1.31 }), false)
  // South China Sea, off Hong Kong
  assert.equal(isInUsWaters({ latitude: 22.30, longitude: 114.17 }), false)
  // Sydney Harbour
  assert.equal(isInUsWaters({ latitude: -33.85, longitude: 151.22 }), false)
})
