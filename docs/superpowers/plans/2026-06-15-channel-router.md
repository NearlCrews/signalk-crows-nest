# Deterministic Channel Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI route-draft and optimize results follow navigable water instead of cutting across land, by computing the geometry with deterministic A* over an ENC-derived navigable grid while the LLM keeps resolving intent and endpoints.

**Architecture:** A new `src/route-draft/channel-router/` slice. `channel-router.ts` fetches ENC charted areas over the route bbox (reusing `queryChartedAreas`), `nav-grid.ts` rasterizes them into a depth-aware navigable grid with a distance-to-shore standoff field, `astar.ts` finds the water path, `path-simplify.ts` reduces it to turning waypoints. `endpoint.ts` calls it after `parseDraftedRoute` (draft) and `anchorRouteEndpoints` (optimize), replacing the waypoints on success and falling back to the LLM/drawn route with a note otherwise. The existing safety check still runs on the result.

**Tech Stack:** TypeScript (Node, ESM, neostandard no-semicolon style), `node:test` via tsx, owned algorithms (binary heap, A*, scanline-free per-polygon rasterization, BFS, RDP) with no new runtime dependency. Reuses `leg-geometry` (`pointInRings`), `depth-area-query` (`queryChartedAreas`, `ChartedAreas`, `EncAreaPolygon`), `geo/position-utilities`, `shared/length`, and `shared/types` (`Position`, `Bbox`).

Spec: `docs/superpowers/specs/2026-06-15-channel-router-design.md`.

---

## File structure

- Create `src/route-draft/channel-router/path-simplify.ts` — RDP reduction of a pixel/cell polyline to turning points. Pure.
- Create `src/route-draft/channel-router/astar.ts` — owned binary min-heap and A* over a cell grid behind a small `AStarGrid` interface. Pure.
- Create `src/route-draft/channel-router/nav-grid.ts` — `buildNavGrid` (depth-aware mask + standoff clearance) and the lon/lat <-> cell transform; implements `AStarGrid`. Pure given `ChartedAreas`.
- Create `src/route-draft/channel-router/channel-router.ts` — orchestrator: fetch ENC over the route bbox, build grid, snap endpoints, A*, simplify, return `Position[]` or `undefined`.
- Create `src/route-draft/channel-router/index.ts` — re-export `routeChannel` and its types.
- Modify `src/route-draft/endpoint.ts` — call the router in `handleDraft` (draft and optimize), replace waypoints or attach the fallback note.
- Tests: one `test/route-draft-channel-*.test.ts` per module (path-simplify, astar, nav-grid, channel-router).

Constants live as module constants in `nav-grid.ts`/`channel-router.ts` (YAGNI; not added to `RouteDraftConfig` in v1).

---

## Task 1: path-simplify (RDP)

**Files:**
- Create: `src/route-draft/channel-router/path-simplify.ts`
- Test: `test/route-draft-channel-path-simplify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test test/route-draft-channel-path-simplify.test.ts`
Expected: FAIL (module not found / `simplifyPath` undefined).

- [ ] **Step 3: Implement**

```ts
/**
 * Ramer-Douglas-Peucker reduction of a dense polyline to its turning points.
 * Points are [x, y] in any planar units (cell coordinates here); epsilon is the
 * max allowed perpendicular deviation, in the same units. The endpoints are always
 * kept. Used to turn an A* centerline into a small set of route waypoints.
 */
export function simplifyPath (
  points: ReadonlyArray<[number, number]>,
  epsilon: number
): Array<[number, number]> {
  if (points.length < 3) return points.map((p) => [p[0], p[1]])
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1e-9
  let far = 0
  let farIdx = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i]
    const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
    if (dist > far) {
      far = dist
      farIdx = i
    }
  }
  if (far <= epsilon) return [[ax, ay], [bx, by]]
  const left = simplifyPath(points.slice(0, farIdx + 1), epsilon)
  const right = simplifyPath(points.slice(farIdx), epsilon)
  return [...left.slice(0, -1), ...right]
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test test/route-draft-channel-path-simplify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/route-draft/channel-router/path-simplify.ts test/route-draft-channel-path-simplify.test.ts
git commit -m "feat(channel-router): RDP path simplification"
```

---

## Task 2: astar (binary heap + grid A*)

**Files:**
- Create: `src/route-draft/channel-router/astar.ts`
- Test: `test/route-draft-channel-astar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

test('findPath crosses open water', () => {
  const g = gridFrom(['.....', '.....', '.....'])
  const path = findPath(g, [0, 1], [4, 1])
  assert.ok(path && path.length >= 2)
  assert.deepEqual(path[0], [0, 1])
  assert.deepEqual(path[path.length - 1], [4, 1])
})

test('findPath routes around a wall', () => {
  const g = gridFrom(['.....', '.###.', '.....'])
  const path = findPath(g, [0, 1], [4, 1])
  assert.ok(path, 'a path exists around the wall')
  for (const [c, r] of path!) assert.ok(g.isNavigable(c, r), 'every step is navigable')
})

test('findPath returns undefined when blocked off', () => {
  const g = gridFrom(['..#..', '..#..', '..#..'])
  assert.equal(findPath(g, [0, 1], [4, 1]), undefined)
})

test('findPath prefers the lower-penalty lane', () => {
  // Two open rows; row 0 carries a heavy penalty, so the path should use row 2.
  const g: AStarGrid = {
    cols: 5,
    rows: 3,
    isNavigable: (c, r) => r !== 1 && c >= 0 && c < 5 && r >= 0 && r < 3,
    stepPenalty: (_c, r) => (r === 0 ? 10 : 0)
  }
  const path = findPath(g, [0, 0], [4, 2])
  assert.ok(path!.some(([, r]) => r === 2))
  assert.ok(!path!.slice(1, -1).some(([, r]) => r === 0))
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test test/route-draft-channel-astar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** The grid A* operates over; coordinates are [col, row], origin top-left. */
export interface AStarGrid {
  cols: number
  rows: number
  /** True when [col, row] is in bounds and navigable. */
  isNavigable: (col: number, row: number) => boolean
  /** Non-negative extra cost for stepping into [col, row] (the standoff cost). */
  stepPenalty: (col: number, row: number) => number
}

/** A tiny binary min-heap keyed by a number priority, payload is the cell index. */
class MinHeap {
  private readonly keys: number[] = []
  private readonly vals: number[] = []
  get size (): number { return this.keys.length }
  push (key: number, val: number): void {
    this.keys.push(key)
    this.vals.push(val)
    let i = this.keys.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(i, p)
      i = p
    }
  }
  pop (): number {
    const top = this.vals[0]
    const lastKey = this.keys.pop() as number
    const lastVal = this.vals.pop() as number
    if (this.keys.length > 0) {
      this.keys[0] = lastKey
      this.vals[0] = lastVal
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < this.keys.length && this.keys[l] < this.keys[s]) s = l
        if (r < this.keys.length && this.keys[r] < this.keys[s]) s = r
        if (s === i) break
        this.swap(i, s)
        i = s
      }
    }
    return top
  }
  private swap (a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k
    const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v
  }
}

const SQRT2 = Math.SQRT2
// 8-connectivity offsets and their step distances.
const NEIGHBORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
]

/**
 * A* over the grid from `start` to `goal` ([col, row]), 8-connected. Step cost is
 * the geometric distance times `1 + stepPenalty(target)`, the Euclidean distance
 * heuristic keeps it admissible (penalty is non-negative, so it never
 * underestimates). Returns the ordered cell path including both endpoints, or
 * `undefined` when the goal is unreachable. A diagonal step is disallowed when it
 * would cut between two blocked orthogonal neighbors, so the path never clips a
 * land corner.
 */
export function findPath (
  grid: AStarGrid,
  start: [number, number],
  goal: [number, number]
): Array<[number, number]> | undefined {
  const { cols, rows } = grid
  if (!grid.isNavigable(start[0], start[1]) || !grid.isNavigable(goal[0], goal[1])) return undefined
  const idx = (c: number, r: number): number => r * cols + c
  const gScore = new Float64Array(cols * rows).fill(Infinity)
  const cameFrom = new Int32Array(cols * rows).fill(-1)
  const goalIdx = idx(goal[0], goal[1])
  const h = (c: number, r: number): number => Math.hypot(c - goal[0], r - goal[1])
  const open = new MinHeap()
  const startIdx = idx(start[0], start[1])
  gScore[startIdx] = 0
  open.push(h(start[0], start[1]), startIdx)
  while (open.size > 0) {
    const cur = open.pop()
    if (cur === goalIdx) break
    const cr = Math.floor(cur / cols)
    const cc = cur - cr * cols
    const baseG = gScore[cur]
    for (const [dc, dr, step] of NEIGHBORS) {
      const nc = cc + dc
      const nr = cr + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      if (!grid.isNavigable(nc, nr)) continue
      if (dc !== 0 && dr !== 0 && (!grid.isNavigable(cc + dc, cr) || !grid.isNavigable(cc, cr + dr))) continue
      const ni = idx(nc, nr)
      const tentative = baseG + step * (1 + grid.stepPenalty(nc, nr))
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative
        cameFrom[ni] = cur
        open.push(tentative + h(nc, nr), ni)
      }
    }
  }
  if (gScore[goalIdx] === Infinity) return undefined
  const path: Array<[number, number]> = []
  for (let i = goalIdx; i !== -1; i = cameFrom[i]) {
    path.push([i % cols, Math.floor(i / cols)])
  }
  return path.reverse()
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test test/route-draft-channel-astar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/route-draft/channel-router/astar.ts test/route-draft-channel-astar.test.ts
git commit -m "feat(channel-router): grid A* with an owned binary heap"
```

---

## Task 3: nav-grid (depth-aware mask + standoff)

**Files:**
- Create: `src/route-draft/channel-router/nav-grid.ts`
- Test: `test/route-draft-channel-nav-grid.test.ts`

The grid is planar over the small route bbox: longitude maps linearly to column, latitude to row (origin top-left, so increasing row goes south). A cell is navigable when it is inside an ENC `Depth_Area` and not blocked by depth (drying or shallower than draft+margin) and not inside a `Land_Area`, and, for optimize, within the corridor. The standoff is a soft per-cell clearance from the nearest blocked cell, computed by a multi-source BFS.

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNavGrid } from '../src/route-draft/channel-router/nav-grid.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/route-draft/../inputs/noaa-enc/depth-area-query.js'

/** A square ring [lon,lat] from corner lon/lat spans. */
function box (w: number, s: number, e: number, n: number, depthRange?: { shallowMeters?: number }): EncAreaPolygon {
  return { rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]], properties: {}, ...(depthRange ? { depthRange } : {}) }
}

const BBOX = { west: 0, south: 0, east: 1, north: 1 }

test('a deep depth area is navigable; outside it is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8, { shallowMeters: 10 })], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0, targetCellMeters: 2000 })
  const inside = g.cellOf({ latitude: 0.5, longitude: 0.5 })
  const outside = g.cellOf({ latitude: 0.05, longitude: 0.05 })
  assert.equal(g.isNavigable(inside[0], inside[1]), true)
  assert.equal(g.isNavigable(outside[0], outside[1]), false)
})

test('a shallow depth area is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8, { shallowMeters: 1 })], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0, targetCellMeters: 2000 })
  const inside = g.cellOf({ latitude: 0.5, longitude: 0.5 })
  assert.equal(g.isNavigable(inside[0], inside[1]), false)
})

test('a land area inside deep water is blocked', () => {
  const charted: ChartedAreas = {
    depthAreas: [box(0.1, 0.1, 0.9, 0.9, { shallowMeters: 10 })],
    landAreas: [box(0.4, 0.4, 0.6, 0.6)]
  }
  const g = buildNavGrid({ bbox: BBOX, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0, targetCellMeters: 2000 })
  const island = g.cellOf({ latitude: 0.5, longitude: 0.5 })
  const water = g.cellOf({ latitude: 0.2, longitude: 0.2 })
  assert.equal(g.isNavigable(island[0], island[1]), false)
  assert.equal(g.isNavigable(water[0], water[1]), true)
})

test('a drying depth area (negative DRVAL1) is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8, { shallowMeters: -1.6 })], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0, targetCellMeters: 2000 })
  const inside = g.cellOf({ latitude: 0.5, longitude: 0.5 })
  assert.equal(g.isNavigable(inside[0], inside[1]), false)
})

test('clearance is higher mid-channel than near shore', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.1, 0.1, 0.9, 0.9, { shallowMeters: 10 })], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 5000, targetCellMeters: 2000 })
  const mid = g.cellOf({ latitude: 0.5, longitude: 0.5 })
  const edge = g.cellOf({ latitude: 0.15, longitude: 0.5 })
  assert.ok(g.stepPenalty(edge[0], edge[1]) >= g.stepPenalty(mid[0], mid[1]))
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test test/route-draft-channel-nav-grid.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Bbox, Position } from '../../shared/types.js'
import type { ChartedAreas, EncAreaPolygon } from '../../inputs/noaa-enc/depth-area-query.js'
import { pointInRings } from '../leg-geometry.js'
import { METERS_PER_NAUTICAL_MILE } from '../../shared/length.js'
import type { AStarGrid } from './astar.js'

/** Standoff cost weight: the multiplier at zero clearance, ramping to 0 at the desired offing. */
const STANDOFF_WEIGHT = 6
/** Default target cell size in meters; the orchestrator may pass a coarser value for a large bbox. */
export const DEFAULT_CELL_METERS = 60
/** Cell-count ceiling; a larger bbox coarsens until it fits. */
export const MAX_CELLS = 600_000

export interface NavGridParams {
  bbox: Bbox
  charted: ChartedAreas
  draftMeters: number
  safetyMarginMeters: number
  /** Desired offing in meters for the soft mid-channel cost; 0 disables the standoff bias. */
  standoffMeters: number
  /** Optional optimize corridor: only cells within halfWidthMeters of the polyline are navigable. */
  corridor?: { polyline: Position[], halfWidthMeters: number }
  targetCellMeters?: number
}

export interface NavGrid extends AStarGrid {
  cellCenter: (col: number, row: number) => Position
  cellOf: (p: Position) => [number, number]
  /** True when the grid has at least one navigable cell (else the route has no coverage). */
  hasWater: boolean
}

const metersPerDegLat = 111_320
const metersPerDegLon = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180)

export function buildNavGrid (params: NavGridParams): NavGrid {
  const { bbox, charted, draftMeters, safetyMarginMeters, standoffMeters } = params
  const midLat = (bbox.north + bbox.south) / 2
  const widthMeters = Math.abs(bbox.east - bbox.west) * metersPerDegLon(midLat)
  const heightMeters = Math.abs(bbox.north - bbox.south) * metersPerDegLat
  // Cell size: the requested target, coarsened until the cell count fits MAX_CELLS.
  let cell = params.targetCellMeters ?? DEFAULT_CELL_METERS
  let cols = Math.max(1, Math.ceil(widthMeters / cell))
  let rows = Math.max(1, Math.ceil(heightMeters / cell))
  while (cols * rows > MAX_CELLS) {
    cell *= 1.5
    cols = Math.max(1, Math.ceil(widthMeters / cell))
    rows = Math.max(1, Math.ceil(heightMeters / cell))
  }
  const lonOf = (col: number): number => bbox.west + ((col + 0.5) / cols) * (bbox.east - bbox.west)
  const latOf = (row: number): number => bbox.north - ((row + 0.5) / rows) * (bbox.north - bbox.south)
  const cellCenter = (col: number, row: number): Position => ({ longitude: lonOf(col), latitude: latOf(row) })
  const cellOf = (p: Position): [number, number] => {
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((p.longitude - bbox.west) / (bbox.east - bbox.west)) * cols)))
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((bbox.north - p.latitude) / (bbox.north - bbox.south)) * rows)))
    return [col, row]
  }

  const contour = draftMeters + safetyMarginMeters
  const covered = new Uint8Array(cols * rows)
  const blocked = new Uint8Array(cols * rows)

  // Rasterize per polygon over only the cells in its own bbox, testing each cell
  // center with the shared pointInRings. A depth area marks coverage; if it is
  // drying (DRVAL1 < 0) or shallower than the contour it also blocks. A land area
  // blocks. "Shallowest wins": any covering area below the contour blocks the cell.
  const stamp = (poly: EncAreaPolygon, onCell: (i: number) => void): void => {
    let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity
    for (const ring of poly.rings) for (const [lon, lat] of ring) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
    const [cMin, rMax] = cellOf({ longitude: west, latitude: south })
    const [cMax, rMin] = cellOf({ longitude: east, latitude: north })
    for (let r = rMin; r <= rMax; r += 1) {
      for (let c = cMin; c <= cMax; c += 1) {
        if (pointInRings(lonOf(c), latOf(r), poly.rings)) onCell(r * cols + c)
      }
    }
  }
  for (const area of charted.depthAreas) {
    const drval1 = area.depthRange?.shallowMeters
    // Block on undefined (unknown depth, never silently passed), drying (<0), or shallower than the
    // contour. Sticky OR across overlapping bands: a later deep stamp never clears an earlier block.
    const tooShallow = drval1 === undefined || drval1 < contour
    stamp(area, (i) => { covered[i] = 1; if (tooShallow) blocked[i] = 1 })
  }
  for (const area of charted.landAreas) stamp(area, (i) => { blocked[i] = 1 })

  const navigable = new Uint8Array(cols * rows)
  let hasWater = false
  for (let i = 0; i < navigable.length; i += 1) {
    if (covered[i] === 1 && blocked[i] === 0) { navigable[i] = 1; hasWater = true }
  }

  // Optimize corridor: restrict to cells within halfWidthMeters of the drawn polyline.
  if (params.corridor !== undefined) {
    const half = params.corridor.halfWidthMeters
    const pts = params.corridor.polyline
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c
        if (navigable[i] === 0) continue
        const here = cellCenter(c, r)
        let near = false
        for (let k = 0; k + 1 < pts.length && !near; k += 1) {
          if (distanceToSegmentMeters(here, pts[k], pts[k + 1], midLat) <= half) near = true
        }
        if (!near) navigable[i] = 0
      }
    }
    hasWater = navigable.includes(1)
  }

  // Standoff clearance: multi-source BFS from every blocked-or-edge cell over
  // navigable cells, in cell units, then a soft penalty that ramps from
  // STANDOFF_WEIGHT at zero clearance to 0 at the desired offing.
  const clearance = new Int32Array(cols * rows).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < navigable.length; i += 1) {
    if (navigable[i] === 0) { clearance[i] = 0; queue.push(i) }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]
    const r = Math.floor(i / cols)
    const c = i - r * cols
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc; const nr = r + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      const ni = nr * cols + nc
      if (clearance[ni] !== -1) continue
      clearance[ni] = clearance[i] + 1
      queue.push(ni)
    }
  }
  const desiredCells = standoffMeters > 0 ? standoffMeters / cell : 0
  const stepPenalty = (col: number, row: number): number => {
    if (desiredCells <= 0) return 0
    const cl = clearance[row * cols + col]
    if (cl < 0 || cl >= desiredCells) return 0
    return STANDOFF_WEIGHT * (1 - cl / desiredCells)
  }

  return {
    cols,
    rows,
    isNavigable: (col, row) => col >= 0 && col < cols && row >= 0 && row < rows && navigable[row * cols + col] === 1,
    stepPenalty,
    cellCenter,
    cellOf,
    hasWater
  }
}

/** Planar distance in meters from a point to a segment, at the bbox's mid latitude. */
function distanceToSegmentMeters (p: Position, a: Position, b: Position, midLat: number): number {
  const mx = metersPerDegLon(midLat)
  const my = metersPerDegLat
  const px = p.longitude * mx; const py = p.latitude * my
  const ax = a.longitude * mx; const ay = a.latitude * my
  const bx = b.longitude * mx; const by = b.latitude * my
  const dx = bx - ax; const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test test/route-draft-channel-nav-grid.test.ts`
Expected: PASS. (The `(METERS_PER_NAUTICAL_MILE)` import is used by the orchestrator, not here; if lint flags it unused, remove the import from this file. It is listed in Task 4's imports.)

Note: remove the unused `METERS_PER_NAUTICAL_MILE` import shown above from `nav-grid.ts`; it belongs in `channel-router.ts`. The import line in nav-grid.ts should be only the `Bbox`, `Position`, `ChartedAreas`, `EncAreaPolygon`, `pointInRings`, and `AStarGrid` imports.

- [ ] **Step 5: Commit**

```bash
git add src/route-draft/channel-router/nav-grid.ts test/route-draft-channel-nav-grid.test.ts
git commit -m "feat(channel-router): depth-aware navigable grid with a standoff field"
```

---

## Task 4: channel-router (orchestrator)

**Files:**
- Create: `src/route-draft/channel-router/channel-router.ts`
- Create: `src/route-draft/channel-router/index.ts`
- Test: `test/route-draft-channel-router.test.ts`

- [ ] **Step 1: Write the failing test** (stubs `queryChartedAreas`, no live HTTP)

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { routeChannel } from '../src/route-draft/channel-router/channel-router.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/route-draft/../inputs/noaa-enc/depth-area-query.js'

function box (w: number, s: number, e: number, n: number, shallowMeters?: number): EncAreaPolygon {
  return { rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]], properties: {}, ...(shallowMeters !== undefined ? { depthRange: { shallowMeters } } : {}) }
}

// An L-shaped deep channel through a land block, so a straight line crosses land.
const charted: ChartedAreas = {
  depthAreas: [box(0.0, 0.0, 0.2, 1.0, 10), box(0.0, 0.0, 1.0, 0.2, 10)],
  landAreas: []
}
const deps = {
  client: {} as never,
  queryChartedAreas: async (): Promise<ChartedAreas> => charted,
  bands: ['harbour'] as never
}

test('routeChannel returns a water-only path around the corner', async () => {
  const wps = await routeChannel(deps, {
    from: { latitude: 0.9, longitude: 0.1 },
    to: { latitude: 0.1, longitude: 0.9 },
    draftMeters: 2,
    safetyMarginMeters: 0.5,
    standoffNm: 0
  })
  assert.ok(wps && wps.length >= 2)
  // Every waypoint sits in the deep L (col<=0.2 or row-lat<=0.2), never the empty quadrant.
  for (const w of wps!) assert.ok(w.longitude <= 0.25 || w.latitude <= 0.25, `${JSON.stringify(w)} on water`)
})

test('routeChannel returns undefined when there is no depth coverage', async () => {
  const empty = { ...deps, queryChartedAreas: async (): Promise<ChartedAreas> => ({ depthAreas: [], landAreas: [] }) }
  const wps = await routeChannel(empty, {
    from: { latitude: 0.9, longitude: 0.1 }, to: { latitude: 0.1, longitude: 0.9 },
    draftMeters: 2, safetyMarginMeters: 0.5, standoffNm: 0
  })
  assert.equal(wps, undefined)
})

test('routeChannel returns undefined when an endpoint cannot be snapped', async () => {
  const wps = await routeChannel(deps, {
    from: { latitude: 0.9, longitude: 0.9 }, to: { latitude: 0.1, longitude: 0.1 },
    draftMeters: 2, safetyMarginMeters: 0.5, standoffNm: 0, maxSnapMeters: 1
  })
  assert.equal(wps, undefined)
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --import tsx --test test/route-draft-channel-router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { EncDirectClient } from '../../inputs/noaa-enc/enc-direct-client.js'
import type { ChartedAreas, ChartedAreasRequest } from '../../inputs/noaa-enc/depth-area-query.js'
import type { ScaleBand } from '../../inputs/noaa-enc/enc-direct-types.js'
import type { Bbox, Logger, Position } from '../../shared/types.js'
import { METERS_PER_NAUTICAL_MILE } from '../../shared/length.js'
import { routeBbox } from '../leg-geometry.js'
import { buildNavGrid, type NavGrid } from './nav-grid.js'
import { findPath } from './astar.js'
import { simplifyPath } from './path-simplify.js'

/** The charted-areas query, matching queryChartedAreas; injected so tests stub it. */
export type QueryChartedAreas = (client: EncDirectClient, request: ChartedAreasRequest) => Promise<ChartedAreas>

export interface ChannelRouterDeps {
  client: EncDirectClient
  queryChartedAreas: QueryChartedAreas
  bands: ScaleBand[]
  logger?: Logger
}

export interface ChannelRouteRequest {
  from: Position
  to: Position
  draftMeters: number
  safetyMarginMeters: number
  standoffNm: number
  /** Optimize only: snap to the channel within this polyline corridor. */
  corridor?: Position[]
  /** Max distance an endpoint may be snapped to navigable water; default below. */
  maxSnapMeters?: number
  signal?: AbortSignal
}

/** Padding added around the endpoints (and corridor) to size the route bbox. */
const BBOX_PAD_METERS = 0.5 * METERS_PER_NAUTICAL_MILE
const DEFAULT_MAX_SNAP_METERS = 0.5 * METERS_PER_NAUTICAL_MILE
/** Corridor half-width for optimize when not overridden. */
const CORRIDOR_HALF_WIDTH_METERS = 1 * METERS_PER_NAUTICAL_MILE
/** RDP epsilon in cells: ~1.5 cells of deviation collapses a near-straight run. */
const SIMPLIFY_EPSILON_CELLS = 1.5

/**
 * Compute a water-following route from `from` to `to` over the ENC charted depth
 * and land areas. Returns the ordered turning waypoints, or `undefined` when the
 * route cannot be computed (no depth coverage, an endpoint that will not snap to
 * navigable water, or no connected water path). The caller falls back to its
 * existing route on `undefined`.
 */
export async function routeChannel (
  deps: ChannelRouterDeps,
  req: ChannelRouteRequest
): Promise<Position[] | undefined> {
  const anchors = req.corridor ?? [req.from, req.to]
  const bbox = routeBbox(anchors, BBOX_PAD_METERS)
  let charted: ChartedAreas
  try {
    charted = await fetchAreas(deps, bbox, req.signal)
  } catch (error) {
    deps.logger?.debug(`channel-router charted-areas fetch failed: ${String(error)}`)
    return undefined
  }
  if (charted.depthAreas.length === 0) return undefined

  const grid = buildNavGrid({
    bbox,
    charted,
    draftMeters: req.draftMeters,
    safetyMarginMeters: req.safetyMarginMeters,
    standoffMeters: req.standoffNm * METERS_PER_NAUTICAL_MILE,
    ...(req.corridor !== undefined ? { corridor: { polyline: req.corridor, halfWidthMeters: CORRIDOR_HALF_WIDTH_METERS } } : {})
  })
  if (!grid.hasWater) return undefined

  const maxSnap = req.maxSnapMeters ?? DEFAULT_MAX_SNAP_METERS
  const start = snapToWater(grid, req.from, maxSnap)
  const goal = snapToWater(grid, req.to, maxSnap)
  if (start === undefined || goal === undefined) return undefined

  const cells = findPath(grid, start, goal)
  if (cells === undefined) return undefined

  const simplified = simplifyPath(cells, SIMPLIFY_EPSILON_CELLS)
  // Pin the exact requested endpoints (the navigator's start/destination), with the
  // A* interior in between, so the saved route begins and ends where intended.
  const interior = simplified.slice(1, -1).map(([c, r]) => grid.cellCenter(c, r))
  return [req.from, ...interior, req.to]
}

/** Fetch and merge the charted areas across the usage bands over one bbox. */
async function fetchAreas (deps: ChannelRouterDeps, bbox: Bbox, signal?: AbortSignal): Promise<ChartedAreas> {
  const perBand = await Promise.all(
    deps.bands.map((band) => deps.queryChartedAreas(deps.client, { band, bbox, signal }))
  )
  return {
    depthAreas: perBand.flatMap((a) => a.depthAreas),
    landAreas: perBand.flatMap((a) => a.landAreas)
  }
}

/** Nearest navigable cell to a position within maxSnapMeters, by expanding-ring search. */
function snapToWater (grid: NavGrid, p: Position, maxSnapMeters: number): [number, number] | undefined {
  const [c0, r0] = grid.cellOf(p)
  if (grid.isNavigable(c0, r0)) return [c0, r0]
  const here = grid.cellCenter(c0, r0)
  const metersPerCol = Math.abs(grid.cellCenter(1, 0).longitude - grid.cellCenter(0, 0).longitude) * 111_320 * Math.cos((here.latitude * Math.PI) / 180)
  const maxRadius = Math.max(1, Math.ceil(maxSnapMeters / Math.max(1, metersPerCol)))
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue
        const c = c0 + dc; const r = r0 + dr
        if (grid.isNavigable(c, r)) return [c, r]
      }
    }
  }
  return undefined
}
```

And `index.ts`:

```ts
export { routeChannel } from './channel-router.js'
export type { ChannelRouterDeps, ChannelRouteRequest } from './channel-router.js'
```

- [ ] **Step 4: Run and watch it pass**

Run: `node --import tsx --test test/route-draft-channel-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors (fix the noted unused import in nav-grid.ts if lint flags it).

- [ ] **Step 6: Commit**

```bash
git add src/route-draft/channel-router/ test/route-draft-channel-router.test.ts
git commit -m "feat(channel-router): orchestrator that routes a water path over ENC areas"
```

---

## Task 5: wire the router into the draft and optimize flows

**Files:**
- Modify: `src/route-draft/endpoint.ts`
- Test: extend `test/route-draft-endpoint.test.ts`

The router runs in `handleDraft` after `parseDraftedRoute` (and after `anchorRouteEndpoints` for optimize), before `checkLegs`. On success it replaces `route.waypoints`; on `undefined` it keeps the route and appends a route-level `other` flag. Endpoints come from the (possibly anchored) first and last waypoints. The service already holds the ENC client, the config (draft, margin, standoff), and `DEPTH_BANDS`.

- [ ] **Step 1: Extract a small applier and add the fallback note constant**

In `endpoint.ts`, import the router and add near the other constants:

```ts
import { routeChannel } from './channel-router/index.js'
import { resolveDraftMeters } from './endpoint.js' // already in-file; do not re-import, shown for context
```

(`resolveDraftMeters` already exists in this file; reuse it.) Add:

```ts
/** Route-level note when automatic channel routing could not run for this passage. */
const CHANNEL_ROUTE_UNAVAILABLE_FLAG: LegFlag = {
  kind: 'other',
  message: 'Automatic channel routing was unavailable here, so this is the raw drafted route; verify every leg on the chart.'
}
```

- [ ] **Step 2: Call the router in handleDraft**

After the `route` is parsed and (for optimize) anchored, and before `const positions = ...`, insert:

```ts
  // Replace the model geometry with a deterministic water-following route where ENC
  // coverage allows; otherwise keep the drafted/anchored route and note it.
  const channel = await routeChannel(
    { client: service.enc, queryChartedAreas, bands: DEPTH_BANDS, logger: { debug: (m) => { app.debug(m) }, error: (m) => { app.error(m) } } },
    {
      from: { latitude: route.waypoints[0].latitude, longitude: route.waypoints[0].longitude },
      to: { latitude: route.waypoints[route.waypoints.length - 1].latitude, longitude: route.waypoints[route.waypoints.length - 1].longitude },
      draftMeters,
      safetyMarginMeters: config.routeDraftSafetyMarginMeters,
      standoffNm: config.routeDraftStandoffNm,
      ...(parsed.route !== undefined ? { corridor: parsed.route } : {}),
      signal: AbortSignal.timeout(Math.max(MS_PER_SECOND, deadlineMs - Date.now()))
    }
  )
  let channelNote: LegFlag | undefined
  if (channel !== undefined && channel.length >= 2) {
    route.waypoints = channel.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
  } else {
    channelNote = CHANNEL_ROUTE_UNAVAILABLE_FLAG
  }
```

Note: `draftMeters` is already computed later in the function via `resolveDraftMeters(app, config)`; move that call above this block so it is available here (it has no side effects). Add `channelNote` to the response flags: in the `res.json({...})` add `...(channelNote !== undefined ? { extraFlags: [channelNote] } : {})` is NOT the shape; instead merge it into the ordered flags. Concretely, after `const check = await withDeadline(...)`, build:

```ts
  const flags = channelNote !== undefined ? [...check.flags, channelNote] : check.flags
```

and change the response's flags line to `...(flags.length > 0 ? { flags: orderFlags(flags) } : {})`.

- [ ] **Step 3: Add the integration tests**

`parseRequest`/`parseDraftedRoute` are unit-tested already; `handleDraft` has no harness, so test the applier behavior at the seam by exporting a small pure helper `applyChannelRoute(route, channel)` from `endpoint.ts` and testing it:

```ts
// in endpoint.ts
export function applyChannelRoute (
  waypoints: Array<{ latitude: number, longitude: number, name?: string }>,
  channel: Position[] | undefined
): { waypoints: typeof waypoints, note: LegFlag | undefined } {
  if (channel !== undefined && channel.length >= 2) {
    return { waypoints: channel.map((p) => ({ latitude: p.latitude, longitude: p.longitude })), note: undefined }
  }
  return { waypoints, note: CHANNEL_ROUTE_UNAVAILABLE_FLAG }
}
```

Then in `handleDraft` use `applyChannelRoute(route.waypoints, channel)` for the replace+note, and test:

```ts
test('applyChannelRoute replaces waypoints when a channel route is returned', () => {
  const r = applyChannelRoute([{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }], [
    { latitude: 1, longitude: 1 }, { latitude: 1.5, longitude: 1.2 }, { latitude: 2, longitude: 2 }
  ])
  assert.equal(r.waypoints.length, 3)
  assert.equal(r.note, undefined)
})

test('applyChannelRoute keeps the route and notes when no channel route', () => {
  const wps = [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }]
  const r = applyChannelRoute(wps, undefined)
  assert.equal(r.waypoints, wps)
  assert.match(r.note?.message ?? '', /channel routing was unavailable/i)
})
```

- [ ] **Step 4: Run the gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:plugin`
Expected: all green; test count rises by the new cases.

- [ ] **Step 5: Commit**

```bash
git add src/route-draft/endpoint.ts test/route-draft-endpoint.test.ts
git commit -m "feat(route-draft): route draft and optimize through the channel router with a fallback note"
```

---

## Task 6: live verification and docs

**Files:**
- Scratch only (no committed code beyond docs).
- Modify: `docs/route-draft-api.md` (note the channel-routed geometry) and `CHANGELOG.md` (0.10.0 Added).

- [ ] **Step 1: Gate green**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Live-verify on boatpi**

Rebuild the plugin dist and restart the SignalK server (`npm run build:plugin && sudo systemctl restart signalk`), then POST a Grosse Ile to Belle Isle draft (admin JWT, wide bounds) and confirm: the returned waypoints follow the river channel (no `land` flags), the check completes, and the served model is logged. Compare against a no-coverage area (open ocean) to confirm the fallback note appears and the LLM route is kept.

- [ ] **Step 3: Docs**

Update `docs/route-draft-api.md` to note that returned waypoints are channel-routed where ENC coverage exists (and the raw drafted route with the unavailable note elsewhere), and add the CHANGELOG 0.10.0 Added entry describing the channel router by what it does.

- [ ] **Step 4: Commit**

```bash
git add docs/route-draft-api.md CHANGELOG.md
git commit -m "docs(route-draft): document channel-routed geometry"
```

---

## Review fixes (folded in from the six-specialist review; these AMEND the tasks above)

Where this section and a task above differ, this section wins. Apply during implementation.

### RF1 (Task 0, new): hoist the planar-meters helpers into `shared/length.ts`

`src/inputs/dedupe-pois.ts` already owns `METERS_PER_DEGREE = 111320` and the `* cos(lat)` longitude scaling; the router must not add more copies. Add to `src/shared/length.ts`:

```ts
/** Meters per degree of latitude (and of longitude at the equator). */
export const METERS_PER_DEGREE = 111_320
/** Meters per degree of longitude at a given latitude. */
export function metersPerDegreeLon (latitude: number): number {
  return METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)
}
```

Refactor `dedupe-pois.ts` to import these (remove its local copy). `nav-grid.ts` and `channel-router.ts` import them; do NOT inline `111_320` anywhere in the new code.

### RF2 (Task 2, astar): visited-skip and a deadline bail

Add a `closed` set and an optional deadline. After `const cur = open.pop()`, `if (closed[cur]) continue; closed[cur] = 1`. Accept `deadlineMs?: number` and every 4096 pops check `if (deadlineMs !== undefined && Date.now() > deadlineMs) return undefined`. `closed` is a `Uint8Array(cols*rows)`. Keep the existing `tentative < gScore` relaxation. (Confirmed correct and unchanged: break-on-goal-pop, the diagonal-corner-cut guard.)

### RF3 (Task 3, nav-grid): scanline rasterization, not per-cell point-in-polygon

Replace the per-cell `stamp`/`pointInRings` loop with a scanline fill (the spec's stated approach; the per-cell version is O(cells x vertices) and risks a Pi timeout). Add:

```ts
/** Fill cells whose CENTER lies inside the polygon (even-odd over all rings) by scanline. */
function fillPolygonCells (
  rings: number[][][], toCol: (lon: number) => number, toRow: (lat: number) => number,
  cols: number, rows: number, onCell: (index: number) => void
): void {
  const edges: Array<[number, number, number, number]> = []
  let rMin = rows; let rMax = -1
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const x0 = toCol(ring[j][0]); const y0 = toRow(ring[j][1])
      const x1 = toCol(ring[i][0]); const y1 = toRow(ring[i][1])
      edges.push([x0, y0, x1, y1])
      rMin = Math.min(rMin, Math.floor(Math.min(y0, y1)))
      rMax = Math.max(rMax, Math.ceil(Math.max(y0, y1)))
    }
  }
  rMin = Math.max(0, rMin); rMax = Math.min(rows - 1, rMax)
  for (let row = rMin; row <= rMax; row += 1) {
    const y = row + 0.5
    const xs: number[] = []
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 > y) === (y1 > y)) continue
      xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cStart = Math.max(0, Math.ceil(xs[k] - 0.5))
      const cEnd = Math.min(cols - 1, Math.floor(xs[k + 1] - 0.5))
      for (let col = cStart; col <= cEnd; col += 1) onCell(row * cols + col)
    }
  }
}
```

with `toCol = (lon) => ((lon - bbox.west) / (bbox.east - bbox.west)) * cols` and `toRow = (lat) => ((bbox.north - lat) / (bbox.north - bbox.south)) * rows`. Use `fillPolygonCells` for both the depth-area stamp (RF: block on undefined/drying/shallow, already fixed inline) and the land stamp. Keep the `covered`/`blocked` sticky-OR.

Other nav-grid amendments:
- **Expose `cellMeters`** on `NavGrid` (the final coarsened `cell`), so the orchestrator's snap is exact (RF6). 
- **Antimeridian / degenerate bbox decline:** at the top of `buildNavGrid`, if `bbox.east <= bbox.west` or the width/height is non-finite or zero, return a grid with `hasWater = false` (the orchestrator then declines, matching the spec's v1 antimeridian behavior). Do not rely on `MAX_CELLS` to mask it.
- **Corridor distance reuse:** replace the local `distanceToSegmentMeters` with `projectPointOntoLeg` from `geo/position-utilities.js` (clamp along-track to `[0, legLen]`, compare `abs(crossTrackMeters)` to the half-width), matching the three existing call sites; if a planar helper is still wanted, build it from `metersPerDegreeLon` (RF1), never a fresh `111_320`.
- **Deadline bail:** accept `deadlineMs?: number`; check it once per row in the rasterize and once per ~4096 cells in the BFS, returning an empty (`hasWater=false`) grid on overrun.
- **Comment fix:** the BFS seeds blocked cells only (not "blocked-or-edge"); correct the comment. The `stepPenalty` linear ramp is kept; reconcile the spec note (done in the spec).
- **Lower `MAX_CELLS` to 250_000** for the Pi, and add a cell-size floor: if fitting under the cap forces `cell` above `MAX_CELL_METERS` (e.g. 250), the route is too large for v1; return `hasWater = false` (decline) rather than a grid too coarse to resolve a channel.

### RF4 (Task 4, channel-router): reason result, full-waypoint bbox, allSettled, final-leg land re-check

- **Result type** (replaces the `Position[] | undefined` return):

```ts
export type ChannelRouteResult =
  | { ok: true, waypoints: Position[] }
  | { ok: false, reason: 'no-coverage' | 'no-path' | 'unsnappable' | 'land-leg' | 'fetch-failed' }
```

Map: fetch threw -> `fetch-failed`; `depthAreas.length === 0` or `!grid.hasWater` -> `no-coverage`; snap fails -> `unsnappable`; `findPath` undefined -> `no-path`; a final leg crosses land -> `land-leg`.

- **Import the canonical type:** `import type { QueryChartedAreas } from '../safety-check.js'` and delete the local `QueryChartedAreas` declaration.
- **`bboxAnchors`:** add `bboxAnchors?: Position[]` to `ChannelRouteRequest`; size the bbox with `routeBbox(req.bboxAnchors ?? req.corridor ?? [req.from, req.to], BBOX_PAD_METERS)`. `endpoint.ts` passes the LLM's full `route.waypoints` as `bboxAnchors` for draft so a winding channel is inside the grid.
- **`fetchAreas` resilience:** use `Promise.allSettled` over the bands, merge the fulfilled ones, proceed if at least one band returned, and only treat it as `fetch-failed` when ALL bands rejected. Log rejected bands at `debug`.
- **Snap by true meters (RF6):** in `snapToWater`, accept a candidate cell only when `distanceMeters(p, grid.cellCenter(c, r)) <= maxSnapMeters` (use `distanceMeters` from `geo/position-utilities.js`); bound the ring radius by `ceil(maxSnapMeters / grid.cellMeters)`. Remove the `cellCenter(1,0)` derivation.
- **Endpoint pinning (RF, honesty):** build the result endpoints as: if `req.from` is navigable use it, else use `grid.cellCenter(start)`; same for `to`. So the saved route never starts/ends on land. The interior is the RDP of the A* path between `start` and `goal`.
- **Final-leg land re-check (RF, the key honesty backstop):** after assembling `waypoints: Position[]`, for each consecutive pair test every land area:

```ts
const landRings = charted.landAreas.map((a) => a.rings)
for (let i = 0; i + 1 < waypoints.length; i += 1) {
  const a = [waypoints[i].longitude, waypoints[i].latitude]
  const b = [waypoints[i + 1].longitude, waypoints[i + 1].latitude]
  if (landRings.some((rings) => segmentCrossesRings(a, b, rings))) return { ok: false, reason: 'land-leg' }
}
return { ok: true, waypoints }
```

(`segmentCrossesRings` is already imported from `leg-geometry`.)
- **RDP epsilon cap:** `SIMPLIFY_EPSILON_CELLS` deviation must not exceed ~50 m on a coarsened grid; pass `simplifyPath(cells, Math.min(1.5, 50 / grid.cellMeters))`.
- **Thread the deadline** into `buildNavGrid` and `findPath`.

### RF5 (Task 5, endpoint): budget skip, shared logger, reason -> note, tested seams

- **Build one `Logger`** local in `handleDraft` and pass it to both `routeChannel` and `checkLegs`.
- **Budget skip (spec-required):** `const ROUTER_MIN_BUDGET_MS = 8_000`; if `deadlineMs - Date.now() < ROUTER_MIN_BUDGET_MS`, skip the router, keep the LLM/drawn route, and attach the note (reason `skipped`). Otherwise call the router.
- **Reason -> note via a tested seam.** Replace `applyChannelRoute` with:

```ts
export function applyChannelRoute (
  waypoints: Array<{ latitude: number, longitude: number, name?: string }>,
  result: ChannelRouteResult | { ok: false, reason: 'skipped' }
): { waypoints: typeof waypoints, note: LegFlag | undefined } {
  if (result.ok) return { waypoints: result.waypoints.map((p) => ({ latitude: p.latitude, longitude: p.longitude })), note: undefined }
  // no-coverage is already spoken by the safety check's per-leg no-charted-depth note; do not double it.
  if (result.reason === 'no-coverage') return { waypoints, note: undefined }
  return { waypoints, note: CHANNEL_ROUTE_UNAVAILABLE_FLAG }
}
```

- **`mergeChannelNote` seam** (tested): `export function mergeChannelNote (checkFlags: LegFlag[], note: LegFlag | undefined): LegFlag[] { return orderFlags(note !== undefined ? [...checkFlags, note] : checkFlags) }`. Use it for the response flags. Test: a `land` check flag still precedes the appended `other`; no-note passes through unchanged.
- **`channelRequestFor` builder** (tested, optional but recommended): a pure helper that builds the `ChannelRouteRequest` from `parsed`, `route`, and `config`, asserting `corridor`/`bboxAnchors` are set iff `parsed.route` is defined; one test that draft has no `corridor` and optimize does.

### RF6 (tests): additions across the suites

Add these concrete cases (house style `node:test`):
- astar: diagonal-corner-cut guard (`gridFrom(['.#','#.'])` start `[0,0]` goal `[1,1]` -> `undefined`); `start === goal` -> `[start]`; blocked-start -> `undefined`; strengthen the open-water test with a per-step `isNavigable` and adjacency assertion.
- nav-grid: overlapping-band shallowest-wins (deep+shallow over one cell -> blocked, asserted both stamp orders); undefined-DRVAL1 area -> blocked; `cellOf`/`cellCenter` round-trip; a one-cell-wide channel at a coarse `targetCellMeters` -> `hasWater` false (honest decline); contour boundary (`shallowMeters` exactly `draft+margin` navigable, just below blocked); make the clearance test strict (`stepPenalty(edge) > stepPenalty(mid)` and `> 0`).
- path-simplify: a five-point zigzag keeps all five at small epsilon; a mid-point just over vs just under epsilon.
- channel-router: a real `Land_Area` island spanning the straight `from->to` line yields a water-only path (assert each waypoint outside the land ring AND that the straight `from->to` crosses the island, proving the input was land-crossing); the optimize `corridor` constrains (every waypoint within the half-width of the drawn polyline); the `land-leg` re-check rejects a route forced across a sub-cell land sliver; endpoints are the requested points when navigable; band merge across two bands.
- endpoint: `mergeChannelNote` ordering and pass-through (RF5); `channelRequestFor` corridor-iff-optimize (RF5).

### RF7: items reviewed and deliberately not changed (by-design)

- Owned A*, binary heap, and RDP over an npm dep: kept (project rule; ~90 lines).
- Module decomposition (four files): kept; `nav-grid` shrinks after RF1/RF3 (drops the local meters helper and the per-cell stamp).
- Using the LLM's interior waypoints as A* via-points (to preserve a stated passage choice): deferred to the spec's follow-up list; v1 routes endpoint-to-endpoint with the full-waypoint bbox (RF4), and the success-case keeps the model's prose `note` as stated intent on a draft-to-verify route.
- Sharing the router's route-bbox fetch with the safety check (batches the check): remains the named follow-up; v1 accepts the extra ENC fetch, bounded by the budget skip (RF5) and the deadline threading (RF2-RF4). Live verification (Task 6) must confirm the full-bbox harbour-band fetch over the Grosse Ile to Belle Isle window is fast enough; if not, the follow-up is pulled forward.

---

## Self-review

- **Spec coverage:** hybrid (Task 5 keeps the LLM, routes between its endpoints); depth-aware ENC mask incl. drying and shallow (Task 3); draft and optimize incl. corridor (Tasks 4, 5); grid+A* owned, no deps (Tasks 1-3); always-on with graceful fallback + note (Tasks 4, 5); safety check still runs (Task 5 leaves `checkLegs` in place); performance via bbox fetch + cell cap + deadline signal (Tasks 3, 4); endpoints pinned to the requested start/end (Task 4); testing per module (every task). Out-of-scope items (OSM water mask, check data-sharing) are not implemented, as intended.
- **Placeholder scan:** none; every code step has complete code. Task 5's two notes (move `resolveDraftMeters` up; the flags merge) are concrete edits, not TBDs.
- **Type consistency:** `Position` `{latitude, longitude}` and `Bbox` `{north,south,east,west}` are the existing shared types; `AStarGrid` (Task 2) is implemented by `NavGrid` (Task 3) which `routeChannel` (Task 4) consumes; `ChartedAreas`/`EncAreaPolygon` come from `depth-area-query`; `simplifyPath`, `findPath`, `buildNavGrid`, `routeChannel`, `applyChannelRoute` names match across tasks; cells are `[col,row]` throughout.
