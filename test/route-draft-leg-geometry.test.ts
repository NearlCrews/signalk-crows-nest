import test from 'node:test'
import assert from 'node:assert/strict'
import { pointInRings, segmentsCross, segmentCrossesRings } from '../src/route-draft/leg-geometry.js'

const SQUARE: number[][][] = [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]

// An outer square spanning [-1, 1] with an inner hole ring spanning [-0.5, 0.5].
const SQUARE_WITH_HOLE: number[][][] = [
  [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]],
  [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]]
]

test('pointInRings is true inside and false outside the ring', () => {
  assert.equal(pointInRings(0, 0, SQUARE), true)
  assert.equal(pointInRings(2, 2, SQUARE), false)
})

test('pointInRings treats the interior of a hole as outside the polygon', () => {
  // Inside the hole is outside the polygon by the even-odd rule.
  assert.equal(pointInRings(0, 0, SQUARE_WITH_HOLE), false)
  // The solid band between the outer ring and the hole is inside the polygon.
  assert.equal(pointInRings(0.75, 0, SQUARE_WITH_HOLE), true)
})

test('segmentsCross detects a proper crossing and rejects a non-crossing pair', () => {
  assert.equal(segmentsCross([-1, 0], [1, 0], [0, -1], [0, 1]), true)
  assert.equal(segmentsCross([-1, 0], [1, 0], [-1, 1], [1, 1]), false)
})

test('segmentCrossesRings is true when a segment cuts a ring edge', () => {
  assert.equal(segmentCrossesRings([-2, 0], [2, 0], SQUARE), true)
  assert.equal(segmentCrossesRings([2, 2], [3, 3], SQUARE), false)
})
