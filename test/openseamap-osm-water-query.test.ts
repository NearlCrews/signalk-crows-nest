import test from 'node:test'
import assert from 'node:assert/strict'
import { queryWaterAreas } from '../src/route-draft/channel-router/osm-water-query.js'
import type { OsmAreaElement, OverpassClient } from '../src/inputs/openseamap/overpass-client.js'

/** A client whose listWaterAreas returns the given elements on every tile call. */
function stubClient (elements: OsmAreaElement[], calls = { n: 0 }): OverpassClient {
  return {
    listPointsOfInterest: async () => [],
    getById: async () => undefined,
    listCoastlineWays: async () => [],
    listWaterAreas: async () => { calls.n += 1; return elements },
    close: () => {}
  }
}

const ONE_TILE = { west: 0, east: 1, south: 0, north: 1 }
const closed = (ring: number[][]): boolean =>
  ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]

test('a closed water way assembles to one water polygon', async () => {
  const el: OsmAreaElement = { element: 'way', kind: 'water', id: 1, points: [[0, 0], [0, 1], [1, 1], [0, 0]] }
  const { water, land } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(land.length, 0)
  assert.equal(water.length, 1)
  assert.deepEqual(water[0].rings, [[[0, 0], [0, 1], [1, 1], [0, 0]]])
})

test('a way with fewer than three vertices is dropped', async () => {
  const el: OsmAreaElement = { element: 'way', kind: 'water', id: 2, points: [[0, 0], [1, 1]] }
  const { water } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(water.length, 0)
})

test('a relation stitches split outer ways and keeps a contained inner as a hole', async () => {
  const el: OsmAreaElement = {
    element: 'relation',
    kind: 'water',
    id: 3,
    members: [
      { role: 'outer', points: [[0, 0], [0, 4]] },
      { role: 'outer', points: [[0, 4], [4, 4], [4, 0], [0, 0]] },
      { role: 'inner', points: [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]] }
    ]
  }
  const { water } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(water.length, 1)
  assert.equal(water[0].rings.length, 2, 'one stitched outer ring plus one inner hole')
  assert.ok(closed(water[0].rings[0]), 'the stitched outer ring is closed')
  assert.ok(closed(water[0].rings[1]), 'the inner hole is closed')
})

test('a relation drops an inner ring not contained in any outer', async () => {
  const el: OsmAreaElement = {
    element: 'relation',
    kind: 'water',
    id: 4,
    members: [
      { role: 'outer', points: [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]] },
      { role: 'inner', points: [[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]] }
    ]
  }
  const { water } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(water.length, 1)
  assert.equal(water[0].rings.length, 1, 'the escaping inner ring is dropped')
})

test('a relation whose outer never closes yields no polygon', async () => {
  const el: OsmAreaElement = {
    element: 'relation',
    kind: 'water',
    id: 8,
    members: [
      { role: 'outer', points: [[0, 0], [0, 1]] },
      { role: 'outer', points: [[5, 5], [6, 6]] }
    ]
  }
  const { water } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(water.length, 0)
})

test('elements are deduped by id across tiles', async () => {
  const el: OsmAreaElement = { element: 'way', kind: 'water', id: 7, points: [[0, 0], [0, 1], [1, 1], [0, 0]] }
  const calls = { n: 0 }
  const { water } = await queryWaterAreas(stubClient([el], calls), { west: 0, east: 3, south: 0, north: 1 })
  assert.ok(calls.n >= 2, 'a wide bbox tiles into multiple client calls')
  assert.equal(water.length, 1, 'the same element returned from two tiles is deduped to one')
})

test('a ring above the vertex cap is decimated', async () => {
  const points: number[][] = []
  for (let i = 0; i < 25000; i += 1) points.push([i * 1e-4, (i % 2) * 1e-4])
  const el: OsmAreaElement = { element: 'way', kind: 'water', id: 9, points }
  const { water } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(water.length, 1)
  assert.ok(water[0].rings[0].length < points.length, 'the ring is decimated below its input size')
  assert.ok(water[0].rings[0].length <= 20_001, 'the ring is at or under the vertex cap')
})

test('a land element lands in the land list, not the water list', async () => {
  const el: OsmAreaElement = { element: 'way', kind: 'land', id: 11, points: [[0, 0], [0, 1], [1, 1], [0, 0]] }
  const { water, land } = await queryWaterAreas(stubClient([el]), ONE_TILE)
  assert.equal(water.length, 0)
  assert.equal(land.length, 1)
})

test('queryWaterAreas rejects only when every tile query fails', async () => {
  const client: OverpassClient = {
    ...stubClient([]),
    listWaterAreas: async () => { throw new Error('Overpass 503') }
  }
  await assert.rejects(() => queryWaterAreas(client, ONE_TILE), /503/)
})
