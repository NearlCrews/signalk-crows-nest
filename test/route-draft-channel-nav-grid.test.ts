import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNavGrid } from '../src/route-draft/channel-router/nav-grid.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/inputs/noaa-enc/depth-area-query.js'

/** A square ring [lon,lat]; pass shallowMeters to make it a Depth_Area with that DRVAL1. */
function box (w: number, s: number, e: number, n: number, shallowMeters?: number): EncAreaPolygon {
  return {
    rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    properties: {},
    ...(shallowMeters !== undefined ? { depthRange: { shallowMeters } } : {})
  }
}

const BBOX = { west: 0, south: 0, east: 1, north: 1 }
const base = { draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0, targetCellMeters: 250 }

test('a deep depth area is navigable; outside it is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8, 10)], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, ...base })
  assert.equal(g.hasWater, true)
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.5 })), true)
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.05, longitude: 0.05 })), false)
})

test('a shallow depth area is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8, 1)], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, ...base })
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.5 })), false)
})

test('a depth area with no DRVAL1 (unknown depth) is blocked, never silently passed', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8)], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, ...base })
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.5 })), false)
})

test('a drying depth area (negative DRVAL1) is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.2, 0.2, 0.8, 0.8, -1.6)], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, ...base })
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.5 })), false)
})

test('a land area inside deep water is blocked', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.1, 0.1, 0.9, 0.9, 10)], landAreas: [box(0.4, 0.4, 0.6, 0.6)] }
  const g = buildNavGrid({ bbox: BBOX, charted, ...base })
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.5 })), false)
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.2, longitude: 0.2 })), true)
})

test('overlapping bands: the shallow reading wins regardless of stamp order', () => {
  const deep = box(0.2, 0.2, 0.8, 0.8, 10)
  const shallow = box(0.2, 0.2, 0.8, 0.8, 1)
  const mid = { latitude: 0.5, longitude: 0.5 }
  const a = buildNavGrid({ bbox: BBOX, charted: { depthAreas: [deep, shallow], landAreas: [] }, ...base })
  const b = buildNavGrid({ bbox: BBOX, charted: { depthAreas: [shallow, deep], landAreas: [] }, ...base })
  assert.equal(a.isNavigable(...a.cellOf(mid)), false)
  assert.equal(b.isNavigable(...b.cellOf(mid)), false)
})

test('the contour boundary is inclusive: exactly draft+margin is navigable, just below is blocked', () => {
  const okGrid = buildNavGrid({ bbox: BBOX, charted: { depthAreas: [box(0.2, 0.2, 0.8, 0.8, 2.5)], landAreas: [] }, ...base })
  const lowGrid = buildNavGrid({ bbox: BBOX, charted: { depthAreas: [box(0.2, 0.2, 0.8, 0.8, 2.4)], landAreas: [] }, ...base })
  const mid = { latitude: 0.5, longitude: 0.5 }
  assert.equal(okGrid.isNavigable(...okGrid.cellOf(mid)), true)
  assert.equal(lowGrid.isNavigable(...lowGrid.cellOf(mid)), false)
})

test('cellOf and cellCenter round-trip to the same cell', () => {
  const g = buildNavGrid({ bbox: BBOX, charted: { depthAreas: [box(0, 0, 1, 1, 10)], landAreas: [] }, ...base })
  for (const p of [{ latitude: 0.5, longitude: 0.5 }, { latitude: 0.13, longitude: 0.77 }, { latitude: 0.9, longitude: 0.1 }]) {
    const [c, r] = g.cellOf(p)
    assert.deepEqual(g.cellOf(g.cellCenter(c, r)), [c, r])
  }
})

test('the standoff cost is higher near shore than mid-channel and is nonzero near shore', () => {
  const charted: ChartedAreas = { depthAreas: [box(0.1, 0.1, 0.9, 0.9, 10)], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 5000, targetCellMeters: 250 })
  const mid = g.cellOf({ latitude: 0.5, longitude: 0.5 })
  const edge = g.cellOf({ latitude: 0.13, longitude: 0.5 })
  assert.ok(g.stepPenalty(...edge) > g.stepPenalty(...mid))
  assert.ok(g.stepPenalty(...edge) > 0)
})

test('the optimize corridor restricts navigable cells to near the drawn polyline', () => {
  const charted: ChartedAreas = { depthAreas: [box(0, 0, 1, 1, 10)], landAreas: [] }
  const g = buildNavGrid({
    bbox: BBOX,
    charted,
    ...base,
    corridor: { polyline: [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.9, longitude: 0.9 }], halfWidthMeters: 3000 }
  })
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.5 })), true) // on the diagonal
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.9, longitude: 0.1 })), false) // far corner
})

test('a degenerate or antimeridian-crossing bbox declines (no water)', () => {
  const charted: ChartedAreas = { depthAreas: [box(0, 0, 1, 1, 10)], landAreas: [] }
  const g = buildNavGrid({ bbox: { west: 1, south: 0, east: 0, north: 1 }, charted, ...base })
  assert.equal(g.hasWater, false)
})

test('a bbox too large to resolve at the cell-size floor declines', () => {
  const charted: ChartedAreas = { depthAreas: [box(0, 0, 50, 50, 10)], landAreas: [] }
  const g = buildNavGrid({ bbox: { west: 0, south: 0, east: 50, north: 50 }, charted, draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0 })
  assert.equal(g.hasWater, false)
})
