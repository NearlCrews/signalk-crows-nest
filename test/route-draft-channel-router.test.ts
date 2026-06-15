import test from 'node:test'
import assert from 'node:assert/strict'
import { routeChannel, routeStaysOnWater, type ChannelRouterDeps } from '../src/route-draft/channel-router/channel-router.js'
import type { OsmAreas } from '../src/route-draft/channel-router/osm-water-query.js'
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

/** A square ring polygon (the OSM water/land shape). */
function ring (w: number, s: number, e: number, n: number): { rings: number[][][] } {
  return { rings: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

const NO_OSM: OsmAreas = { water: [], land: [] }
const NO_ENC: ChartedAreas = { depthAreas: [], landAreas: [] }

function deps (charted: ChartedAreas, osm: OsmAreas = NO_OSM, over: Partial<ChannelRouterDeps> = {}): ChannelRouterDeps {
  return {
    client: {} as never,
    queryChartedAreas: async () => charted,
    overpass: {} as never,
    queryWaterAreas: async () => osm,
    bands: ['harbour'] as ScaleBand[],
    ...over
  }
}

const base = { draftMeters: 2, safetyMarginMeters: 0.5, standoffNm: 0 }

// An L-shaped deep channel: a straight from->to line crosses the empty top-right quadrant.
const encL: ChartedAreas = { depthAreas: [encBox(0, 0, 0.2, 1, 10), encBox(0, 0, 1, 0.2, 10)], landAreas: [] }
const osmL: OsmAreas = { water: [ring(0, 0, 0.2, 1), ring(0, 0, 1, 0.2)], land: [] }
const CORNER_FROM: Position = { latitude: 0.9, longitude: 0.1 }
const CORNER_TO: Position = { latitude: 0.1, longitude: 0.9 }

test('routeChannel routes an ENC channel around the corner, on water, not via OSM', async () => {
  const r = await routeChannel(deps(encL), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  for (const w of r.waypoints) {
    assert.ok(w.longitude <= 0.25 || w.latitude <= 0.25, `${JSON.stringify(w)} is on the deep L`)
  }
  assert.equal(r.usedOsmWater, false)
})

test('routeChannel routes an OSM-water-only channel and marks it depth-unverified', async () => {
  const r = await routeChannel(deps(NO_ENC, osmL), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  for (const w of r.waypoints) {
    assert.ok(w.longitude <= 0.25 || w.latitude <= 0.25, `${JSON.stringify(w)} is on the OSM water L`)
  }
  assert.equal(r.usedOsmWater, true)
})

// A diagonal from->to whose straight line is blocked by a vertical wall (a gap at the top),
// in a small bbox that resolves below the cell-size floor.
const WALL_FROM: Position = { latitude: 0.05, longitude: 0.05 }
const WALL_TO: Position = { latitude: 0.25, longitude: 0.25 }

test('routeChannel rounds an OSM land wall that blocks the straight line', async () => {
  const osm: OsmAreas = { water: [ring(0, 0, 0.3, 0.3)], land: [ring(0.14, 0, 0.16, 0.22)] }
  const r = await routeChannel(deps(NO_ENC, osm), { from: WALL_FROM, to: WALL_TO, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.waypoints.length >= 3, 'the route bends around the land wall rather than going straight')
})

test('routeChannel: an ENC land wall over OSM water still forces a detour', async () => {
  const charted: ChartedAreas = { depthAreas: [], landAreas: [encBox(0.14, 0, 0.16, 0.22)] }
  const osm: OsmAreas = { water: [ring(0, 0, 0.3, 0.3)], land: [] }
  const r = await routeChannel(deps(charted, osm), { from: WALL_FROM, to: WALL_TO, ...base })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.waypoints.length >= 3, 'the route bends around the ENC land wall')
})

test('routeChannel declines with no coverage when neither source covers the route', async () => {
  const r = await routeChannel(deps(NO_ENC, NO_OSM), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.deepEqual(r, { ok: false, reason: 'no-coverage' })
})

test('routeChannel declines coverage-incomplete when the OSM land mask was capped', async () => {
  const osm: OsmAreas = { water: [ring(0, 0, 1, 1)], land: [], landIncomplete: true }
  const r = await routeChannel(deps(NO_ENC, osm), { from: CORNER_FROM, to: CORNER_TO, ...base })
  assert.deepEqual(r, { ok: false, reason: 'coverage-incomplete' })
})

test('routeChannel declines no-path for disconnected basins', async () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0, 0, 0.3, 1, 10), encBox(0.7, 0, 1, 1, 10)], landAreas: [] }
  const r = await routeChannel(deps(charted), { from: { latitude: 0.5, longitude: 0.1 }, to: { latitude: 0.5, longitude: 0.9 }, ...base })
  assert.deepEqual(r, { ok: false, reason: 'no-path' })
})

test('routeChannel declines unsnappable when the endpoints are far from water', async () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0.13, 0.13, 0.17, 0.17, 10)], landAreas: [] }
  const r = await routeChannel(deps(charted), {
    from: { latitude: 0, longitude: 0 }, to: { latitude: 0.3, longitude: 0.3 }, ...base, maxSnapMeters: 1
  })
  assert.deepEqual(r, { ok: false, reason: 'unsnappable' })
})

test('routeChannel declines fetch-failed only when both sources throw', async () => {
  const r = await routeChannel(
    deps(NO_ENC, NO_OSM, {
      queryChartedAreas: async () => { throw new Error('ENC down') },
      queryWaterAreas: async () => { throw new Error('Overpass down') }
    }),
    { from: CORNER_FROM, to: CORNER_TO, ...base }
  )
  assert.deepEqual(r, { ok: false, reason: 'fetch-failed' })
})

test('routeChannel keeps routing when one source fails and the other covers', async () => {
  const r = await routeChannel(
    deps(NO_ENC, osmL, { queryChartedAreas: async () => { throw new Error('ENC down') } }),
    { from: CORNER_FROM, to: CORNER_TO, ...base }
  )
  assert.equal(r.ok, true)
})

test('routeChannel declines an antimeridian-crossing route before any fetch', async () => {
  let encCalled = false
  let osmCalled = false
  const r = await routeChannel(
    deps(encL, NO_OSM, {
      queryChartedAreas: async () => { encCalled = true; return encL },
      queryWaterAreas: async () => { osmCalled = true; return NO_OSM }
    }),
    { from: { latitude: 0, longitude: 179 }, to: { latitude: 0, longitude: -179 }, ...base }
  )
  assert.equal(r.ok, false)
  assert.equal(encCalled, false, 'no ENC fetch for an antimeridian bbox')
  assert.equal(osmCalled, false, 'no OSM fetch for an antimeridian bbox')
})

test('routeChannel constrains the optimize corridor to the drawn polyline', async () => {
  const osm: OsmAreas = { water: [ring(0, 0, 1, 1)], land: [] }
  const corridor: Position[] = [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.9, longitude: 0.9 }]
  const r = await routeChannel(deps(NO_ENC, osm), {
    from: { latitude: 0.1, longitude: 0.1 }, to: { latitude: 0.9, longitude: 0.9 }, ...base, corridor
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  // Every waypoint stays near the drawn diagonal (lat close to lon).
  for (const w of r.waypoints) assert.ok(Math.abs(w.latitude - w.longitude) < 0.25, `${JSON.stringify(w)} near the diagonal`)
})

test('routeStaysOnWater rejects a leg that crosses a land ring', () => {
  const charted: ChartedAreas = { depthAreas: [encBox(0, 0, 1, 1, 10)], landAreas: [encBox(0.4, 0.4, 0.6, 0.6)] }
  const across: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.5, longitude: 0.9 }]
  const around: Position[] = [{ latitude: 0.5, longitude: 0.1 }, { latitude: 0.9, longitude: 0.5 }, { latitude: 0.5, longitude: 0.9 }]
  assert.equal(routeStaysOnWater(across, charted, NO_OSM, 2.5, 5000), false)
  assert.equal(routeStaysOnWater(around, charted, NO_OSM, 2.5, 5000), true)
})

test('routeStaysOnWater rejects a leg that leaves the OSM water polygon', () => {
  const osm: OsmAreas = { water: [ring(0, 0, 1, 0.3)], land: [] }
  const leaves: Position[] = [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.9, longitude: 0.9 }]
  const stays: Position[] = [{ latitude: 0.1, longitude: 0.1 }, { latitude: 0.1, longitude: 0.9 }]
  assert.equal(routeStaysOnWater(leaves, NO_ENC, osm, 2.5, 5000), false)
  assert.equal(routeStaysOnWater(stays, NO_ENC, osm, 2.5, 5000), true)
})
