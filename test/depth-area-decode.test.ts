/**
 * Tests for the Depth_Area DRVAL1/DRVAL2 decode in s57-mapping.
 *
 * The ENC Direct Depth_Area layer ships `DRVAL1` (shallow range minimum) and
 * `DRVAL2` (deep range maximum) as JSON numbers in meters at chart datum,
 * verified live: e.g. `DRVAL1: 0`, `DRVAL2: 18.2`, and the drying intertidal
 * pairs `DRVAL1: -1.6` / `DRVAL2: 0`. The decoder is faithful: it preserves a
 * negative DRVAL1 (a drying height above datum) rather than clamping it, leaving
 * the land-versus-water classification to the leg check.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeDepthRange } from '../src/inputs/noaa-enc/s57-mapping.js'

test('decodeDepthRange reads DRVAL1 and DRVAL2 as meters', () => {
  const range = decodeDepthRange({ DRVAL1: 0, DRVAL2: 18.2 })
  assert.equal(range.shallowMeters, 0)
  assert.equal(range.deepMeters, 18.2)
})

test('decodeDepthRange preserves a negative DRVAL1 drying height', () => {
  // Harbour Depth_Area returns drying intertidal areas with DRVAL1 < 0; the
  // negative is the height the area dries to above datum and must survive decode
  // so the leg check can classify the area as land.
  const range = decodeDepthRange({ DRVAL1: -1.6, DRVAL2: 0 })
  assert.equal(range.shallowMeters, -1.6)
  assert.equal(range.deepMeters, 0)
})

test('decodeDepthRange treats null and missing values as absent', () => {
  const range = decodeDepthRange({ DRVAL1: null, DRVAL2: undefined })
  assert.equal(range.shallowMeters, undefined)
  assert.equal(range.deepMeters, undefined)
  const empty = decodeDepthRange({})
  assert.equal(empty.shallowMeters, undefined)
  assert.equal(empty.deepMeters, undefined)
})

test('decodeDepthRange rejects non-numeric wire values', () => {
  // Unlike QUASOU and TECSOU, DRVAL1/DRVAL2 arrive as JSON numbers, so a
  // string is not a valid depth and is treated as absent rather than parsed.
  const range = decodeDepthRange({ DRVAL1: 'deep', DRVAL2: NaN })
  assert.equal(range.shallowMeters, undefined)
  assert.equal(range.deepMeters, undefined)
})
