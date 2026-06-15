import test from 'node:test'
import assert from 'node:assert/strict'
import { findPath, type AStarGrid } from '../src/route-draft/channel-router/astar.js'

/** A grid from rows of '.' (navigable) and '#' (blocked). */
function gridFrom (rows: string[]): AStarGrid {
  const cols = rows[0].length
  const nav = (c: number, r: number): boolean =>
    r >= 0 && r < rows.length && c >= 0 && c < cols && rows[r][c] === '.'
  return { cols, rows: rows.length, isNavigable: nav, stepPenalty: () => 0 }
}

/** Each step is to an adjacent (within one cell) navigable cell. */
function assertContiguous (path: Array<[number, number]>, g: AStarGrid): void {
  for (const [c, r] of path) assert.ok(g.isNavigable(c, r), `step ${c},${r} is navigable`)
  for (let i = 1; i < path.length; i += 1) {
    assert.ok(Math.abs(path[i][0] - path[i - 1][0]) <= 1 && Math.abs(path[i][1] - path[i - 1][1]) <= 1, 'steps are adjacent')
  }
}

test('findPath crosses open water', () => {
  const g = gridFrom(['.....', '.....', '.....'])
  const path = findPath(g, [0, 1], [4, 1])
  assert.ok(path && path.length >= 2)
  assert.deepEqual(path![0], [0, 1])
  assert.deepEqual(path![path!.length - 1], [4, 1])
  assertContiguous(path!, g)
})

test('findPath routes around a wall', () => {
  const g = gridFrom(['.....', '.###.', '.....'])
  const path = findPath(g, [0, 1], [4, 1])
  assert.ok(path)
  assertContiguous(path!, g)
})

test('findPath returns undefined when blocked off', () => {
  const g = gridFrom(['..#..', '..#..', '..#..'])
  assert.equal(findPath(g, [0, 1], [4, 1]), undefined)
})

test('findPath does not cut a diagonal between two blocked orthogonal cells', () => {
  // The only diagonal step from [0,0] to [1,1] would slip between the two '#'.
  const g = gridFrom(['.#', '#.'])
  assert.equal(findPath(g, [0, 0], [1, 1]), undefined)
})

test('findPath returns the single cell when start equals goal', () => {
  const g = gridFrom(['...'])
  assert.deepEqual(findPath(g, [1, 0], [1, 0]), [[1, 0]])
})

test('findPath returns undefined when the start is blocked', () => {
  const g = gridFrom(['#..'])
  assert.equal(findPath(g, [0, 0], [2, 0]), undefined)
})

test('findPath dips out of a high-penalty row when a cheaper lane exists', () => {
  // Fully open 5x3 grid; row 0 carries a heavy step penalty. The straight
  // [0,0]->[4,0] run stays in row 0 absent the penalty, so a penalty-aware A*
  // must dip its interior into the cheaper rows below.
  const g: AStarGrid = {
    cols: 5,
    rows: 3,
    isNavigable: (c, r) => c >= 0 && c < 5 && r >= 0 && r < 3,
    stepPenalty: (_c, r) => (r === 0 ? 10 : 0)
  }
  const path = findPath(g, [0, 0], [4, 0])
  assert.ok(path)
  assert.ok(path!.slice(1, -1).some(([, r]) => r >= 1), 'the interior leaves the penalized row 0')
})
