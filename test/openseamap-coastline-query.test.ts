import test from 'node:test'
import assert from 'node:assert/strict'
import { queryCoastline } from '../src/inputs/openseamap/coastline-query.js'
import type { OverpassClient, CoastlineWay } from '../src/inputs/openseamap/overpass-client.js'

function stubClient (ways: CoastlineWay[], calls: { n: number }): OverpassClient {
  return {
    listPointsOfInterest: async () => [],
    getById: async () => undefined,
    listCoastlineWays: async () => { calls.n += 1; return ways },
    listWaterAreas: async () => [],
    close: () => {}
  }
}

test('queryCoastline tiles a wide bbox into multiple client calls and unions the ways', async () => {
  const calls = { n: 0 }
  const client = stubClient([{ points: [[0, 0], [1, 1]] }], calls)
  const ways = await queryCoastline(client, { south: 0, north: 5, west: 0, east: 5 })
  assert.equal(calls.n, 9)
  assert.equal(ways.length, 9)
})
