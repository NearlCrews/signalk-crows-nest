import test from 'node:test'
import assert from 'node:assert/strict'
import { LAYER_IDS_BY_BAND } from '../src/inputs/noaa-enc/enc-direct-types.js'

// The ids route each query to the matching ArcGIS service layer, so they are
// load-bearing: a transposition (say, swapping the harbour and coastal wreck
// ids) would silently query the wrong layer while every id stayed positive.
// Pinning the known-good table makes such a regression fail loudly. An
// intentional upstream renumbering is a deliberate edit to both tables.
const EXPECTED_LAYER_IDS = {
  overview: { wreck: 24, obstruction: 21, rock: 22 },
  general: { wreck: 29, obstruction: 26, rock: 27 },
  coastal: { wreck: 33, obstruction: 30, rock: 31 },
  approach: { wreck: 39, obstruction: 36, rock: 37 },
  harbour: { wreck: 36, obstruction: 33, rock: 34 },
  berthing: { wreck: 21, obstruction: 19, rock: 20 }
} as const

test('every scale band resolves to its known-good ENC Direct layer-id set', () => {
  assert.deepEqual(LAYER_IDS_BY_BAND, EXPECTED_LAYER_IDS)
})

test('no scale-band layer id is a zero placeholder', () => {
  for (const [band, ids] of Object.entries(LAYER_IDS_BY_BAND)) {
    for (const [key, id] of Object.entries(ids)) {
      assert.ok(
        Number.isInteger(id) && id > 0,
        `${band}.${key} must be a positive layer id, got ${id}`
      )
    }
  }
})
