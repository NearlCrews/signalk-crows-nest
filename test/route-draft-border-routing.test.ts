import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNavGrid } from '../src/route-draft/channel-router/nav-grid.js'
import { routeChannel, type ChannelRouterDeps } from '../src/route-draft/channel-router/channel-router.js'
import type { AreaPolygon, TileWater } from '../src/route-draft/channel-router/index.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/inputs/noaa-enc/depth-area-query.js'
import type { ScaleBand } from '../src/shared/scale-band.js'
import type { Position } from '../src/shared/types.js'

const BBOX = { west: 0, south: 0, east: 1, north: 1 }
const NAV_BASE = { draftMeters: 2, safetyMarginMeters: 0.5, standoffMeters: 0, targetCellMeters: 250 }

function encBox (w: number, s: number, e: number, n: number, shallowMeters?: number): EncAreaPolygon {
  return {
    rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    properties: {},
    ...(shallowMeters !== undefined ? { depthRange: { shallowMeters } } : {}),
  }
}
function ring (w: number, s: number, e: number, n: number): AreaPolygon {
  return { rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

test('foreignBlock clears the foreign side but does not erode the home side', () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0, 0, 1, 1, 10)], landAreas: [] }
  const g = buildNavGrid({ bbox: BBOX, charted, foreignBlock: [ring(0.5, 0, 1, 1)], ...NAV_BASE })
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.25 })), true) // home side
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.75 })), false) // foreign side
  // The home cell beside the border stays navigable: the block stamps blocked, not landMask, so the
  // one-cell shore erosion does not pinch the home channel a cell off the boundary.
  assert.equal(g.isNavigable(...g.cellOf({ latitude: 0.5, longitude: 0.49 })), true)
})

const ROUTE_BASE = { draftMeters: 2, safetyMarginMeters: 0.5, standoffNm: 0 }
function deps (charted: ChartedAreas, water: TileWater = { water: [] }): ChannelRouterDeps {
  return {
    client: {} as never,
    queryChartedAreas: async () => charted,
    queryWater: async () => water,
    bands: ['harbour'] as ScaleBand[],
  }
}
const DEEP: ChartedAreas = { depthAreas: [encBox(0, 0, 1, 1, 10)], landAreas: [] }

test('routeChannel falls back across the border when no in-country path exists', async () => {
  const from: Position = { latitude: 0.5, longitude: 0.1 }
  const to: Position = { latitude: 0.5, longitude: 0.9 }
  // A foreign strip down the middle disconnects the west endpoint from the east one.
  const r = await routeChannel(deps(DEEP), {
    from,
    to,
    ...ROUTE_BASE,
    foreignRings: () => [ring(0.4, 0, 0.6, 1)],
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.borderFallback, true)
})

test('routeChannel stays in-country with no fallback when a path avoids foreign water', async () => {
  const from: Position = { latitude: 0.5, longitude: 0.1 }
  const to: Position = { latitude: 0.5, longitude: 0.3 }
  // Foreign water sits far east, off the from-to path, so the in-country attempt succeeds.
  const r = await routeChannel(deps(DEEP), {
    from,
    to,
    ...ROUTE_BASE,
    foreignRings: () => [ring(0.7, 0, 1, 1)],
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.notEqual(r.borderFallback, true)
  assert.ok(r.waypoints.length >= 2)
})

test('routeChannel is unchanged when no foreignRings is supplied', async () => {
  const from: Position = { latitude: 0.5, longitude: 0.1 }
  const to: Position = { latitude: 0.5, longitude: 0.9 }
  const r = await routeChannel(deps(DEEP), { from, to, ...ROUTE_BASE })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.notEqual(r.borderFallback, true)
  assert.ok(r.waypoints.length >= 2)
})
