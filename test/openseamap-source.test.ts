import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenSeaMapSource } from '../src/inputs/openseamap/openseamap-source.js'
import type { OverpassClient, OverpassElement } from '../src/inputs/openseamap/overpass-client.js'
import type { PluginStatus } from '../src/status/plugin-status.js'
import type { Bbox } from '../src/shared/types.js'

const sampleBbox: Bbox = { north: 1, south: 0, east: 1, west: 0 }

/** A no-op status recorder, used by source tests that do not inspect status. */
function silentStatus (): PluginStatus {
  return {
    recordListFetch: () => {},
    recordDetailSuccess: () => {},
    recordError: () => {},
    recordSkipped: () => {},
    wasJustSkipped: () => false,
    snapshot: () => ({}) as never
  }
}

const rockNode: OverpassElement = {
  type: 'node',
  id: 123,
  tags: { 'seamark:type': 'rock', name: 'Big Rock' },
  position: { latitude: 50, longitude: 1 }
}

const marinaWay: OverpassElement = {
  type: 'way',
  id: 456,
  tags: { leisure: 'marina' },
  position: { latitude: 51, longitude: 2 }
}

/** A client over a fixed element set, counting its by-id detail queries. */
function fakeClient (overrides: Partial<OverpassClient> = {}): {
  client: OverpassClient
  getByIdCalls: () => number
} {
  let calls = 0
  const client: OverpassClient = {
    listPointsOfInterest: async (): Promise<OverpassElement[]> => [rockNode, marinaWay],
    getById: async (): Promise<OverpassElement | undefined> => {
      calls++
      return rockNode
    },
    close: () => {},
    ...overrides
  }
  return { client, getByIdCalls: () => calls }
}

test('listPointsOfInterest maps elements to source-tagged summaries', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(source.id, 'openseamap')
  assert.deepEqual(list, [
    {
      id: 'node_123',
      type: 'Hazard',
      position: { latitude: 50, longitude: 1 },
      name: 'Big Rock',
      source: 'openseamap',
      url: 'https://www.openstreetmap.org/node/123',
      attribution: '© OpenStreetMap contributors (ODbL)',
      skIcon: 'hazard'
    },
    {
      id: 'way_456',
      type: 'Marina',
      position: { latitude: 51, longitude: 2 },
      name: 'Unnamed marina',
      source: 'openseamap',
      url: 'https://www.openstreetmap.org/way/456',
      attribution: '© OpenStreetMap contributors (ODbL)',
      skIcon: 'marina'
    }
  ])
  source.close()
})

test('a navaid element rides the navigation-structure skIcon', async () => {
  const lightNode: OverpassElement = {
    type: 'node',
    id: 777,
    tags: { 'seamark:type': 'light_major', name: 'Pendeen Lighthouse' },
    position: { latitude: 50, longitude: -5 }
  }
  const { client } = fakeClient({
    listPointsOfInterest: async () => [lightNode],
    getById: async () => lightNode
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['navaids'], status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(list[0].type, 'Navigational')
  assert.equal(list[0].skIcon, 'navigation-structure', 'a navaid summary carries the navigation-structure icon')
  const view = await source.getDetails('node_777')
  assert.equal(view.skIcon, 'navigation-structure', 'the detail view carries the same icon')
  source.close()
})

test('an isolated-danger buoy rides the hazard glyph, not the navigation-structure one', async () => {
  const isolatedDanger: OverpassElement = {
    type: 'node',
    id: 888,
    tags: { 'seamark:type': 'buoy_isolated_danger', name: 'IDM 5' },
    position: { latitude: 50, longitude: -5 }
  }
  const { client } = fakeClient({
    listPointsOfInterest: async () => [isolatedDanger],
    getById: async () => isolatedDanger
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['navaids'], status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(list[0].type, 'Navigational',
    'the PoiType stays Navigational so the buoy does not falsely trigger the proximity alarms')
  assert.equal(list[0].skIcon, 'hazard',
    'an isolated-danger mark renders with the hazard glyph because that is its purpose')
  source.close()
})

test('every element carries an explicit skIcon mapped to a Freeboard-registered icon', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  // The rock element maps directly to the hazard glyph.
  assert.equal(list[0].skIcon, 'hazard', 'a rock carries the hazard icon')
  // The marina way (leisure=marina with no seamark:type) maps to marina.
  assert.equal(list[1].skIcon, 'marina', 'a leisure=marina way carries the marina icon')
  source.close()
})

test('getDetails serves a listed element from cache without a by-id query', async () => {
  const { client, getByIdCalls } = fakeClient()
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], status: silentStatus() })
  await source.listPointsOfInterest(sampleBbox, '')
  const view = await source.getDetails('node_123')
  assert.equal(view.name, 'Big Rock')
  assert.equal(view.type, 'Hazard')
  assert.equal(view.source, 'openseamap')
  assert.equal(view.url, 'https://www.openstreetmap.org/node/123')
  assert.ok(
    view.description?.includes('© OpenStreetMap contributors (ODbL)'),
    'the rendered description carries the ODbL attribution footer'
  )
  assert.equal(getByIdCalls(), 0, 'a listed element is served from cache')
  source.close()
})

test('getDetails queries the client by id on a cache miss with the slash form', async () => {
  const seenIds: string[] = []
  const { client } = fakeClient({
    getById: async (typedId: string) => {
      seenIds.push(typedId)
      return {
        type: 'node',
        id: 123,
        tags: { 'seamark:type': 'rock', name: 'Big Rock' },
        position: { latitude: 50, longitude: 1 }
      }
    }
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], status: silentStatus() })
  const view = await source.getDetails('node_123')
  assert.equal(view.name, 'Big Rock')
  assert.deepEqual(seenIds, ['node/123'], 'the underscore id is translated back to the slash form for Overpass')
  source.close()
})

test('getDetails rejects when the element no longer exists', async () => {
  const { client } = fakeClient({
    getById: async (): Promise<OverpassElement | undefined> => undefined
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], status: silentStatus() })
  await assert.rejects(() => source.getDetails('node_999'), /No OpenSeaMap element found/)
  source.close()
})

test('cacheSize reflects the elements stashed from a list query', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], status: silentStatus() })
  assert.equal(source.cacheSize(), 0)
  await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(source.cacheSize(), 2)
  source.close()
})

test('getDetails records a per-source detail success on the status recorder', async () => {
  const successes: string[] = []
  const status: PluginStatus = {
    ...silentStatus(),
    recordDetailSuccess: (source) => successes.push(source)
  }
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], status })
  await source.listPointsOfInterest(sampleBbox, '')
  await source.getDetails('node/123')
  assert.deepEqual(successes, ['openseamap'])
  source.close()
})

test('getDetails records a per-source detail error when the client rejects', async () => {
  const errors: Array<{ source: string, message: string }> = []
  const status: PluginStatus = {
    ...silentStatus(),
    recordError: (source, message) => errors.push({ source, message })
  }
  const { client } = fakeClient({
    getById: async (): Promise<OverpassElement | undefined> => {
      throw new Error('overpass down')
    }
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], status })
  await assert.rejects(() => source.getDetails('node/999'))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].source, 'openseamap')
  assert.match(errors[0].message, /overpass down/)
  source.close()
})
