import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileWaterSource, pickZoom, tilesForBbox } from '../src/route-draft/channel-router/tile-water-query.js'
import type { VectorTileClient, TileGeometry } from '../src/inputs/vector-tiles/vector-tile-client.js'
import type { Bbox } from '../src/shared/types.js'

const square = (lon: number, lat: number, size: number): Bbox => ({ west: lon, east: lon + size, south: lat, north: lat + size })
/** A zero-size bbox that always covers exactly one tile, for conversion and cache assertions. */
const ONE_TILE: Bbox = { west: -122.405, east: -122.405, south: 37.825, north: 37.825 }

function stub (fetchLayer: VectorTileClient['fetchLayer']): VectorTileClient {
  return { fetchLayer, close: () => {} }
}

test('pickZoom chooses the highest zoom whose tile count fits the cap', () => {
  const tiny = square(-122.41, 37.82, 0.01)
  assert.equal(pickZoom(tiny), 14)
  const mid = square(-122.6, 37.6, 0.3)
  const z = pickZoom(mid)
  assert.ok(z !== undefined && z < 14)
  assert.ok(tilesForBbox(mid, z!).length <= 16, 'the chosen zoom fits the cap')
  assert.ok(tilesForBbox(mid, z! + 1).length > 16, 'the next zoom up would exceed the cap')
})

test('pickZoom declines a bbox too large to cover within the cap', () => {
  // A 20-degree window cannot fit 16 tiles even at the minimum zoom.
  assert.equal(pickZoom({ west: 0, east: 20, south: 0, north: 20 }), undefined)
})

test('queryTileWater converts a Polygon to one AreaPolygon, keeping island holes', async () => {
  const outer = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
  const hole = [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]]
  const geom: TileGeometry = { type: 'Polygon', coordinates: [outer, hole] }
  const source = createTileWaterSource(stub(async () => [geom]))
  const { water } = await source.queryTileWater(ONE_TILE)
  assert.equal(water.length, 1)
  assert.equal(water[0].rings.length, 2, 'the island hole is preserved as a second ring')
})

test('queryTileWater splits a MultiPolygon into several AreaPolygons', async () => {
  const ring = (o: number): number[][] => [[o, o], [o, o + 0.1], [o + 0.1, o + 0.1], [o, o]]
  const geom: TileGeometry = { type: 'MultiPolygon', coordinates: [[ring(0)], [ring(0.5)]] }
  const source = createTileWaterSource(stub(async () => [geom]))
  const { water } = await source.queryTileWater(ONE_TILE)
  assert.equal(water.length, 2)
})

test('queryTileWater tolerates a failed tile and returns the rest', async () => {
  const bbox = { west: -122.42, east: -122.39, south: 37.820, north: 37.825 } // about two z14 tiles
  assert.ok(tilesForBbox(bbox, pickZoom(bbox)!).length >= 2)
  const geom: TileGeometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }
  const source = createTileWaterSource(stub(async (_z, x) => { if (x % 2 === 0) throw new Error('tile down'); return [geom] }))
  const { water } = await source.queryTileWater(bbox)
  assert.ok(water.length >= 1, 'the surviving tile still contributes water')
})

test('queryTileWater rejects when every tile fails', async () => {
  const source = createTileWaterSource(stub(async () => { throw new Error('Overpass-like 503') }))
  await assert.rejects(() => source.queryTileWater(square(-122.41, 37.82, 0.01)), /503/)
})

test('queryTileWater caches a tile, fetching it once across two queries', async () => {
  let calls = 0
  const geom: TileGeometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }
  const source = createTileWaterSource(stub(async () => { calls += 1; return [geom] }))
  await source.queryTileWater(ONE_TILE)
  await source.queryTileWater(ONE_TILE)
  assert.equal(calls, 1, 'the second query hits the cache')
})

test('queryTileWater decimates a ring above the per-polygon vertex cap', async () => {
  const ring: number[][] = []
  for (let i = 0; i < 25_000; i += 1) ring.push([i * 1e-6, (i % 2) * 1e-6])
  ring.push([0, 0])
  const source = createTileWaterSource(stub(async () => [{ type: 'Polygon', coordinates: [ring] }]))
  const { water } = await source.queryTileWater(ONE_TILE)
  assert.ok(water[0].rings[0].length < ring.length, 'the dense ring is decimated')
  assert.ok(water[0].rings[0].length <= 20_001)
})
