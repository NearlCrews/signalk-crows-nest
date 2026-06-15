import test from 'node:test'
import assert from 'node:assert/strict'
import { simplifyPath } from '../src/route-draft/channel-router/path-simplify.js'

test('simplifyPath collapses a straight run to its endpoints', () => {
  const line: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0]]
  assert.deepEqual(simplifyPath(line, 0.5), [[0, 0], [3, 0]])
})

test('simplifyPath keeps a corner beyond the tolerance', () => {
  const line: Array<[number, number]> = [[0, 0], [5, 0], [5, 5]]
  assert.deepEqual(simplifyPath(line, 0.5), [[0, 0], [5, 0], [5, 5]])
})

test('simplifyPath returns short inputs unchanged', () => {
  assert.deepEqual(simplifyPath([[0, 0], [1, 1]], 1), [[0, 0], [1, 1]])
  assert.deepEqual(simplifyPath([[0, 0]], 1), [[0, 0]])
})

test('simplifyPath keeps every corner of a zigzag at a small epsilon', () => {
  const zig: Array<[number, number]> = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 4]]
  assert.deepEqual(simplifyPath(zig, 0.5), zig)
})

test('simplifyPath drops a point just under epsilon and keeps one just over', () => {
  // The middle point deviates 0.4 from the [0,0]->[10,0] line: under epsilon 0.5, dropped.
  assert.deepEqual(simplifyPath([[0, 0], [5, 0.4], [10, 0]], 0.5), [[0, 0], [10, 0]])
  // 0.6 deviation: over epsilon, kept.
  assert.deepEqual(simplifyPath([[0, 0], [5, 0.6], [10, 0]], 0.5), [[0, 0], [5, 0.6], [10, 0]])
})
