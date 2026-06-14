import test from 'node:test'
import assert from 'node:assert/strict'
import { pointInRings, segmentsCross, segmentCrossesRings, polylineCrossesLeg, nearestPolylineApproachMeters } from '../src/route-draft/leg-geometry.js'
import type { Position } from '../src/shared/types.js'

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

const COASTLINE: number[][] = [[-1, 0], [1, 0]] // an open west-to-east line at lat 0

test('polylineCrossesLeg is true when the leg crosses the open coastline line', () => {
  const from: Position = { latitude: -1, longitude: 0 }
  const to: Position = { latitude: 1, longitude: 0 }
  assert.equal(polylineCrossesLeg(from, to, [COASTLINE]), true)
})

test('polylineCrossesLeg is false for a leg that stays on one side', () => {
  const from: Position = { latitude: 0.5, longitude: -1 }
  const to: Position = { latitude: 0.5, longitude: 1 }
  assert.equal(polylineCrossesLeg(from, to, [COASTLINE]), false)
})

test('nearestPolylineApproachMeters finds a close pass to a sparse segment', () => {
  // Leg parallel to and ~1 nm north of a coastline segment whose nearest vertex
  // is far away; vertex-only sampling would miss it, segment distance does not.
  const from: Position = { latitude: 0.016, longitude: -0.5 }
  const to: Position = { latitude: 0.016, longitude: 0.5 }
  const d = nearestPolylineApproachMeters(from, to, [[[-5, 0], [5, 0]]])
  assert.ok(d !== undefined && d < 2000, `expected a close pass, got ${String(d)}`)
})

test('nearestPolylineApproachMeters returns undefined when the coastline is off the leg span', () => {
  const from: Position = { latitude: 0, longitude: 3 }
  const to: Position = { latitude: 0, longitude: 4 }
  const d = nearestPolylineApproachMeters(from, to, [[[-1, 0], [1, 0]]])
  assert.equal(d, undefined)
})
