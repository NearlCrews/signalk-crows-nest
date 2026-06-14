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
  // Just past the east edge (longitude 44) and the north edge (latitude 91) is outside.
  assert.equal(isInEmodnetCoverage({ latitude: 43.3, longitude: 44 }), false)
  assert.equal(isInEmodnetCoverage({ latitude: 91, longitude: 5.4 }), false)
})
