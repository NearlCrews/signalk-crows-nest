import test from 'node:test'
import assert from 'node:assert/strict'
import { isInEncCoverage, isInEmodnetCoverage } from '../src/shared/regions.js'

test('US ENC coverage matches US waters and excludes Europe', () => {
  assert.equal(isInEncCoverage({ latitude: 40.5, longitude: -74 }), true)
  assert.equal(isInEncCoverage({ latitude: 43.3, longitude: 5.4 }), false)
})

test('EMODnet coverage includes the Med and excludes the US east coast', () => {
  assert.equal(isInEmodnetCoverage({ latitude: 43.3, longitude: 5.4 }), true)
  assert.equal(isInEmodnetCoverage({ latitude: 40.5, longitude: -74 }), false)
})

test('EMODnet coverage pins the rectangle edges', () => {
  // The inclusive lower-left corner is inside.
  assert.equal(isInEmodnetCoverage({ latitude: 15, longitude: -36 }), true)
  // The east edge is longitude 43 (inclusive), so 43 is inside and 44 is past it.
  assert.equal(isInEmodnetCoverage({ latitude: 43.3, longitude: 43 }), true)
  assert.equal(isInEmodnetCoverage({ latitude: 43.3, longitude: 44 }), false)
  // The north edge is latitude 90 (inclusive), so 91 is past it.
  assert.equal(isInEmodnetCoverage({ latitude: 91, longitude: 5.4 }), false)
})
