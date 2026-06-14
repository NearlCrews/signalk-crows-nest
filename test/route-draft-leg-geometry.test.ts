import test from 'node:test'
import assert from 'node:assert/strict'
import { pointInRings, segmentsCross, segmentCrossesRings } from '../src/route-draft/leg-geometry.js'

const SQUARE: number[][][] = [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]

test('pointInRings is true inside and false outside the ring', () => {
  assert.equal(pointInRings(0, 0, SQUARE), true)
  assert.equal(pointInRings(2, 2, SQUARE), false)
})

test('segmentsCross detects a proper crossing and rejects a non-crossing pair', () => {
  assert.equal(segmentsCross([-1, 0], [1, 0], [0, -1], [0, 1]), true)
  assert.equal(segmentsCross([-1, 0], [1, 0], [-1, 1], [1, 1]), false)
})

test('segmentCrossesRings is true when a segment cuts a ring edge', () => {
  assert.equal(segmentCrossesRings([-2, 0], [2, 0], SQUARE), true)
  assert.equal(segmentCrossesRings([2, 2], [3, 3], SQUARE), false)
})
