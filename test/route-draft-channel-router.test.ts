import test from 'node:test'
import assert from 'node:assert/strict'
import { routeChannel, routeStaysOnWater, type ChannelRouterDeps } from '../src/route-draft/channel-router/channel-router.js'
import type { TileWater, AreaPolygon } from '../src/route-draft/channel-router/index.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/inputs/noaa-enc/depth-area-query.js'
import type { ScaleBand } from '../src/shared/scale-band.js'
import type { Position } from '../src/shared/types.js'

/** An ENC area box; pass shallowMeters to make it a Depth_Area with that DRVAL1. */
function encBox (w: number, s: number, e: number, n: number, shallowMeters?: number): EncAreaPolygon {
  return {
    rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    properties: {},
    ...(shallowMeters !== undefined ? { depthRange: { shallowMeters } } : {})
  }
}

/** A square water polygon. */
function ring (w: number, s: number, e: number, n: number): AreaPolygon {
  return { rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

/** A water polygon with a rectangular island hole. */
function ringWithHole (w: number, s: number, e: number, n: number, hw: number, hs: number, he: number, hn: number): AreaPolygon {
  return { rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]], [[hw, hs], [he, hs], [he, hn], [hw, hn], [hw, hs]]] }
}

const NO_ENC: ChartedAreas = { depthAreas: [], landAreas: [] }
const NO_WATER: TileWater = { water: [] }

function deps (charted: ChartedAreas, water: TileWater = NO_WATER, over: Partial<ChannelRouterDeps> = {}): ChannelRouterDeps {
  return {
    client: {} as never,
    queryChartedAreas: async () => charted,
    queryWater: async () => water,
    bands: ['harbour'] as ScaleBand[],
    ...over
  }
}

const base = { draftMeters: 2, safetyMarginMeters: 0.5, standoffNm: 0 }

// An L-shaped deep channel: a straight from->to line crosses the empty top-right quadrant.
const encL: ChartedAreas = { depthAreas: [encBox(0, 0, 0.2, 1, 10), encBox(0, 0, 1, 0.2, 10)], landAreas: [] }
const tileL: TileWater = { water: [ring(0, 0, 0.2, 1), ring(0, 0, 1, 0.2)] }
const CORNER_FROM: Position = { latitude: 0.9, longitude: 0.1 }
const CORNER_TO: Position = { latitude: 0.1, longitude: 0.9 }

test('routeChannel routes an ENC channel around the corner, on water, not via tile water', async () => {
  const r = await routeChannel(deps(encL), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  for (const w of r.waypoints) assert.ok(w.longitude <= 0.25 || w.latitude <= 0.25, `${JSON.stringify(w)} is on the deep L`)
  assert.equal(r.usedTileWater, false)
})

test('routeChannel routes a tile-water-only channel and marks it depth-unverified', async () => {
  const r = await routeChannel(deps(NO_ENC, tileL), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  for (const w of r.waypoints) assert.ok(w.longitude <= 0.25 || w.latitude <= 0.25, `${JSON.stringify(w)} is on the tile-water L`)
  assert.equal(r.usedTileWater, true)
})

test('routeChannel rounds a tile-water island hole that blocks the straight line', async () => {
  // Water fills the square with a central island hole; a lon-0.05-to-0.95 leg must go around it.
  const water: TileWater = { water: [ringWithHole(0, 0, 0.3, 0.3, 0.13, 0.05, 0.17, 0.25)] }
  const r = await routeChannel(deps(NO_ENC, water), { from: { latitude: 0.12, longitude: 0.05 }, to: { latitude: 0.12, longitude: 0.25 }, ...base, bboxAnchors: [{ latitude: 0.02, longitude: 0.05 }, { latitude: 0.28, longitude: 0.25 }] })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.waypoints.length >= 3, 'the route bends around the island')
})

test('routeChannel: an ENC land area blocks over tile water and forces a detour', async () => {
  const charted: ChartedAreas = { depthAreas: [], landAreas: [encBox(0.14, 0, 0.16, 0.22)] }
  const water: TileWater = { water: [ring(0, 0, 0.3, 0.3)] }
  const r = await routeChannel(deps(charted, water), { from: { latitude: 0.05, longitude: 0.05 }, to: { latitude: 0.25, longitude: 0.25 }, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.waypoints.length >= 3, 'the route bends around the ENC land')
})

test('routeChannel declines no-coverage when neither source covers the route', async () => {
  const r = await routeChannel(deps(NO_ENC, NO_WATER), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.deepEqual(r, { ok: false, reason: 'no-coverage' })
})

test('routeChannel declines no-path for disconnected basins', async () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0, 0, 0.3, 1, 10), encBox(0.7, 0, 1, 1, 10)], landAreas: [] }
  const r = await routeChannel(deps(charted), { from: { latitude: 0.5, longitude: 0.1 }, to: { latitude: 0.5, longitude: 0.9 }, ...base })
  assert.deepEqual(r, { ok: false, reason: 'no-path' })
})

test('routeChannel declines unsnappable when the endpoints are far from water', async () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0.13, 0.13, 0.17, 0.17, 10)], landAreas: [] }
  const r = await routeChannel(deps(charted), { from: { latitude: 0, longitude: 0 }, to: { latitude: 0.3, longitude: 0.3 }, ...base, maxSnapMeters: 1 })
  assert.deepEqual(r, { ok: false, reason: 'unsnappable' })
})

test('routeChannel snaps an endpoint outside the water to the default reach (a couple of nm)', async () => {
  // `from` sits ~1.3 nm south of the water box, on no navigable cell. The default snap cap (no
  // maxSnapMeters) must still reach the channel, the case a near-shore or island endpoint hits.
  const water: TileWater = { water: [ring(0.1, 0.1, 0.3, 0.3)] }
  const r = await routeChannel(deps(NO_ENC, water), { from: { latitude: 0.08, longitude: 0.2 }, to: { latitude: 0.2, longitude: 0.2 }, ...base })
  assert.equal(r.ok, true)
})

test('routeChannel snaps past an isolated pocket to the main channel and routes', async () => {
  // `from` sits in a tiny pocket disconnected from the main water. Snapping must skip the pocket
  // (which A* cannot escape) and land on the main body, else the route declines no-path even though
  // the through-channel is in reach. This is the Detroit-River near-shore case.
  const pocket = ring(0.0, 0.05, 0.01, 0.06)
  const main = ring(0.02, 0.0, 0.3, 0.3)
  const water: TileWater = { water: [pocket, main] }
  const r = await routeChannel(deps(NO_ENC, water), { from: { latitude: 0.055, longitude: 0.005 }, to: { latitude: 0.15, longitude: 0.15 }, ...base })
  assert.equal(r.ok, true)
})

test('routeChannel declines fetch-failed only when both sources throw', async () => {
  const r = await routeChannel(
    deps(NO_ENC, NO_WATER, {
      queryChartedAreas: async () => { throw new Error('ENC down') },
      queryWater: async () => { throw new Error('tiles down') }
    }),
    { from: CORNER_FROM, to: CORNER_TO, ...base }
  )
  assert.deepEqual(r, { ok: false, reason: 'fetch-failed' })
})

test('routeChannel keeps routing when ENC fails and tile water covers', async () => {
  const r = await routeChannel(
    deps(NO_ENC, tileL, { queryChartedAreas: async () => { throw new Error('ENC down') } }),
    { from: CORNER_FROM, to: CORNER_TO, ...base }
  )
  assert.equal(r.ok, true)
})

test('routeChannel declines an antimeridian-crossing route before any fetch', async () => {
  let encCalled = false
  let tileCalled = false
  const r = await routeChannel(
    deps(encL, NO_WATER, {
      queryChartedAreas: async () => { encCalled = true; return encL },
      queryWater: async () => { tileCalled = true; return NO_WATER }
    }),
    { from: { latitude: 0, longitude: 179 }, to: { latitude: 0, longitude: -179 }, ...base }
  )
  assert.equal(r.ok, false)
  assert.equal(encCalled, false, 'no ENC fetch for an antimeridian bbox')
  assert.equal(tileCalled, false, 'no tile fetch for an antimeridian bbox')
})

test('routeChannel constrains the optimize corridor to the drawn polyline', async () => {
  const water: TileWater = { water: [ring(0, 0, 1, 1)] }
  const corridor: Position[] = [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.9, longitude: 0.9 }]
  const r = await routeChannel(deps(NO_ENC, water), { from: { latitude: 0.1, longitude: 0.1 }, to: { latitude: 0.9, longitude: 0.9 }, ...base, corridor })
  assert.equal(r.ok, true)
  if (!r.ok) return
  for (const w of r.waypoints) assert.ok(Math.abs(w.latitude - w.longitude) < 0.25, `${JSON.stringify(w)} near the diagonal`)
})

const SPACING = 5000
const CONTOUR = 2.5

test('routeStaysOnWater rejects a leg that crosses an ENC land area', () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0, 0, 1, 1, 10)], landAreas: [encBox(0.4, 0.4, 0.6, 0.6)] }
  const across: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.5, longitude: 0.9 }]
  const around: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.9, longitude: 0.5 }, { latitude: 0.5, longitude: 0.9 }]
  assert.equal(routeStaysOnWater(across, charted, NO_WATER, CONTOUR, SPACING), false)
  assert.equal(routeStaysOnWater(around, charted, NO_WATER, CONTOUR, SPACING), true)
})

test('routeStaysOnWater rejects a leg that crosses a tile-water island hole (exact)', () => {
  const water: TileWater = { water: [ringWithHole(0, 0, 1, 1, 0.4, 0.4, 0.6, 0.6)] }
  const across: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.5, longitude: 0.9 }]
  const around: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.9, longitude: 0.5 }, { latitude: 0.5, longitude: 0.9 }]
  assert.equal(routeStaysOnWater(across, NO_ENC, water, CONTOUR, SPACING), false)
  assert.equal(routeStaysOnWater(around, NO_ENC, water, CONTOUR, SPACING), true)
})

test('routeStaysOnWater rejects a leg that leaves the tile water (sampled coast)', () => {
  const water: TileWater = { water: [ring(0, 0, 1, 0.3)] } // water only in the south band
  const leaves: Position[] = [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.9, longitude: 0.9 }]
  const stays: Position[] = [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.1, longitude: 0.9 }]
  assert.equal(routeStaysOnWater(leaves, NO_ENC, water, CONTOUR, SPACING), false)
  assert.equal(routeStaysOnWater(stays, NO_ENC, water, CONTOUR, SPACING), true)
})

test('routeStaysOnWater treats an ENC drying area as land', () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0, 0, 1, 1, 10), encBox(0.4, 0.4, 0.6, 0.6, -1.5)], landAreas: [] }
  const across: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.5, longitude: 0.9 }]
  assert.equal(routeStaysOnWater(across, charted, NO_WATER, CONTOUR, SPACING), false)
})
