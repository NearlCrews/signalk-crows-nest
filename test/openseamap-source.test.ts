import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createOpenSeaMapSource } from '../src/inputs/openseamap/openseamap-source.js'
import type { OverpassClient, OverpassElement } from '../src/inputs/openseamap/overpass-client.js'
import type { PluginStatus } from '../src/status/plugin-status.js'
import type { Bbox } from '../src/shared/types.js'
import { withTempDir } from './helpers.js'

const sampleBbox: Bbox = { north: 1, south: 0, east: 1, west: 0 }

/** A no-op status recorder, used by source tests that do not inspect status. */
function silentStatus (): PluginStatus {
  return {
    recordListFetch: () => {},
    recordDetailSuccess: () => {},
    recordError: () => {},
    recordSkipped: () => {},
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
    listCoastlineWays: async () => [],
    close: () => {},
    ...overrides
  }
  return { client, getByIdCalls: () => calls }
}

test('listPointsOfInterest maps elements to source-tagged summaries', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
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
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['navaids'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
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
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['navaids'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(list[0].type, 'Navigational',
    'the PoiType stays Navigational so the buoy does not falsely trigger the proximity alarms')
  assert.equal(list[0].skIcon, 'hazard',
    'an isolated-danger mark renders with the hazard glyph because that is its purpose')
  source.close()
})

test('every element carries an explicit skIcon mapped to a Freeboard-registered icon', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  // The rock element maps directly to the hazard glyph.
  assert.equal(list[0].skIcon, 'hazard', 'a rock carries the hazard icon')
  // The marina way (leisure=marina with no seamark:type) maps to marina.
  assert.equal(list[1].skIcon, 'marina', 'a leisure=marina way carries the marina icon')
  source.close()
})

test('getDetails serves a listed element from cache without a by-id query', async () => {
  const { client, getByIdCalls } = fakeClient()
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  await source.listPointsOfInterest(sampleBbox, '')
  const view = await source.getDetails('node_123')
  assert.equal(view.name, 'Big Rock')
  assert.equal(view.type, 'Hazard')
  assert.equal(view.source, 'openseamap')
  assert.equal(view.url, 'https://www.openstreetmap.org/node/123')
  // The ODbL credit no longer rides inline in the description; it lives on
  // `properties.attribution` of the produced note (covered by the
  // note-builder tests). This source-level check confirms the inline
  // footer has been removed.
  assert.doesNotMatch(view.description ?? '', /crows-nest-attribution/)
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
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  const view = await source.getDetails('node_123')
  assert.equal(view.name, 'Big Rock')
  assert.deepEqual(seenIds, ['node/123'], 'the underscore id is translated back to the slash form for Overpass')
  source.close()
})

test('getDetails rejects when the element no longer exists', async () => {
  const { client } = fakeClient({
    getById: async (): Promise<OverpassElement | undefined> => undefined
  })
  // An absent element is a not-found on a healthy upstream: the Overpass
  // query answered normally, so the source must record a detail success,
  // never an error that would flip the status row to unreachable.
  const successes: string[] = []
  const errors: string[] = []
  const status: PluginStatus = {
    ...silentStatus(),
    recordDetailSuccess: (source) => successes.push(source),
    recordError: (_source, message) => errors.push(message)
  }
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status })
  await assert.rejects(() => source.getDetails('node_999'), /No OpenSeaMap element found/)
  assert.deepEqual(successes, ['openseamap'], 'the normal upstream answer records a detail success')
  assert.deepEqual(errors, [], 'a not-found must not record a reachability error')
  source.close()
})

test('cacheSize reflects the elements stashed from a list query', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  assert.equal(source.cacheSize(), 0)
  await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(source.cacheSize(), 2)
  source.close()
})

test('getDetails records a per-source detail success on a real upstream fetch (cache miss)', async () => {
  const successes: string[] = []
  const status: PluginStatus = {
    ...silentStatus(),
    recordDetailSuccess: (source) => successes.push(source)
  }
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status })
  // No preceding list call, so the id is a cache miss: getDetails performs a
  // real getById and that upstream success is what records the detail
  // success (a cache hit must NOT, covered by its own test).
  await source.getDetails('node_123')
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
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status })
  await assert.rejects(() => source.getDetails('node_999'))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].source, 'openseamap')
  assert.match(errors[0].message, /overpass down/)
  source.close()
})

test('summary carries timestamp when the wire element has one', async () => {
  const dated: OverpassElement = {
    type: 'node',
    id: 999,
    tags: { 'seamark:type': 'rock', name: 'Dated Rock' },
    position: { latitude: 50, longitude: 1 },
    timestamp: '2024-03-12T14:23:01Z'
  }
  const { client } = fakeClient({
    listPointsOfInterest: async (): Promise<OverpassElement[]> => [dated]
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(list[0].timestamp, '2024-03-12T14:23:01Z')
  source.close()
})

test('summary has no timestamp when the wire element omits one', async () => {
  // rockNode has no timestamp (the existing fixture).
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  for (const summary of list) {
    assert.equal(summary.timestamp, undefined)
  }
  source.close()
})

test('minimumYear drops elements whose OSM timestamp is older than the threshold', async () => {
  const oldElement: OverpassElement = {
    type: 'node',
    id: 1,
    tags: { 'seamark:type': 'rock', name: 'Old Rock' },
    position: { latitude: 50, longitude: 1 },
    timestamp: '1995-06-15T10:00:00Z'
  }
  const newElement: OverpassElement = {
    type: 'node',
    id: 2,
    tags: { 'seamark:type': 'rock', name: 'New Rock' },
    position: { latitude: 50, longitude: 1.1 },
    timestamp: '2022-01-10T09:00:00Z'
  }
  const { client } = fakeClient({
    listPointsOfInterest: async (): Promise<OverpassElement[]> => [oldElement, newElement]
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 2000, refreshSeconds: 0, status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'node_2')
  source.close()
})

test('an undated OSM element always survives the year filter', async () => {
  // rockNode has no timestamp; minimumYear in the far future would otherwise
  // drop every dated element.
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 2099, refreshSeconds: 0, status: silentStatus() })
  const list = await source.listPointsOfInterest(sampleBbox, '')
  assert.ok(list.length > 0, 'an undated element is always kept')
  source.close()
})

test('listPointsOfInterest reuses the bbox-cached result within refreshSeconds', async () => {
  // Fetches are counted per requested tile: the warm second call may also
  // prefetch neighbor tiles in the background (the edge-proximity warmup),
  // and those must not be mistaken for a re-fetch of the viewport itself.
  const fetchedTiles: string[] = []
  const { client } = fakeClient({
    listPointsOfInterest: async (bbox: Bbox): Promise<OverpassElement[]> => {
      fetchedTiles.push(`${bbox.south}_${bbox.west}_${bbox.north}_${bbox.east}`)
      return [rockNode]
    }
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 60, status: silentStatus() })
  await source.listPointsOfInterest(sampleBbox, '')
  await source.listPointsOfInterest(sampleBbox, '')
  // sampleBbox is tile-aligned, so its snapped tile is itself.
  const viewportFetches = fetchedTiles.filter((tile) => tile === '0_0_1_1')
  assert.equal(viewportFetches.length, 1, 'the second call within the TTL hits the bbox cache')
  source.close()
})

test('getDetails on a cache hit does not record a detail success', async () => {
  // A detail cache hit makes no upstream call, so it is not evidence of
  // Overpass reachability: recording a success would flip a stale
  // apiReachable=false back to true just because the user clicked a
  // previously loaded marker. Mirrors the NOAA ENC source.
  const successes: string[] = []
  const status: PluginStatus = {
    ...silentStatus(),
    recordDetailSuccess: (source) => successes.push(source)
  }
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status })
  await source.listPointsOfInterest(sampleBbox, '') // seeds the detail cache
  await source.getDetails('node_123') // served from cache, no upstream call
  assert.deepEqual(successes, [], 'a cache hit records no detail success')
  source.close()
})

test('close clears the in-memory detail cache', async () => {
  const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(source.cacheSize(), 2)
  source.close()
  assert.equal(source.cacheSize(), 0, 'close drops the detail cache, matching the NOAA source')
})

test('listPointsOfInterest queries upstream every call when refreshSeconds is 0 (off)', async () => {
  let calls = 0
  const { client } = fakeClient({
    listPointsOfInterest: async (): Promise<OverpassElement[]> => {
      calls++
      return [rockNode]
    }
  })
  const source = createOpenSeaMapSource({ client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
  await source.listPointsOfInterest(sampleBbox, '')
  await source.listPointsOfInterest(sampleBbox, '')
  assert.equal(calls, 2)
  source.close()
})

test('a listed element survives a restart and renders offline from the on-disk store', async () => {
  await withTempDir('openseamap-source-', async (dir) => {
    // First run: list seeds the detail cache and persists to disk, then close
    // flushes the debounced write.
    const first = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus(), dataDir: dir })
    await first.listPointsOfInterest(sampleBbox, '')
    first.close()
    assert.ok(existsSync(join(dir, 'openseamap-cache.json')), 'the detail store is written on close')

    // Second run: the client is offline (both list and by-id reject), yet the
    // previously fetched element renders from the hydrated store without any
    // upstream call.
    let getByIdCalls = 0
    const offlineClient: OverpassClient = {
      listPointsOfInterest: async () => { throw new Error('offline') },
      getById: async () => { getByIdCalls++; throw new Error('offline') },
      listCoastlineWays: async () => [],
      close: () => {}
    }
    const second = createOpenSeaMapSource({ client: offlineClient, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus(), dataDir: dir })
    assert.equal(second.cacheSize(), 2, 'the store hydrates the detail cache on a cold start')
    const view = await second.getDetails('node_123')
    assert.equal(view.name, 'Big Rock')
    assert.equal(view.type, 'Hazard')
    assert.equal(getByIdCalls, 0, 'a hydrated element is served without an upstream fetch')
    second.close()
  })
})

test('without a data directory the source persists nothing and starts blank', async () => {
  await withTempDir('openseamap-source-', async (dir) => {
    const source = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus() })
    await source.listPointsOfInterest(sampleBbox, '')
    source.close()
    assert.equal(existsSync(join(dir, 'openseamap-cache.json')), false, 'no store file is written without a data directory')
  })
})

test('an offline list falls back to hydrated markers within the bbox and records a stale serve', async () => {
  await withTempDir('openseamap-source-', async (dir) => {
    // First run seeds and persists the two fixture elements (at lat 50-51).
    const first = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus(), dataDir: dir })
    await first.listPointsOfInterest(sampleBbox, '')
    first.close()

    // Second run is offline: the upstream list rejects, so the source rebuilds
    // markers from the hydrated detail cache for the requested box and records a
    // stale serve rather than a reachable fetch.
    const staleServes: Array<{ source: string, reason: string }> = []
    const status: PluginStatus = { ...silentStatus(), recordStaleServe: (source, reason) => staleServes.push({ source, reason }) }
    const offlineClient: OverpassClient = {
      listPointsOfInterest: async () => { throw new Error('offline') },
      getById: async () => { throw new Error('offline') },
      listCoastlineWays: async () => [],
      close: () => {}
    }
    const second = createOpenSeaMapSource({ client: offlineClient, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status, dataDir: dir })
    // A box that covers the fixture positions (lat 50-51, lon 1-2).
    const list = await second.listPointsOfInterest({ south: 49, west: 0, north: 52, east: 3 }, '')
    assert.deepEqual(list.map((poi) => poi.id).sort(), ['node_123', 'way_456'],
      'both previously fetched markers reappear offline')
    assert.deepEqual(staleServes, [{ source: 'openseamap', reason: 'Overpass unreachable' }])
    second.close()
  })
})

test('an offline list with nothing cached inside the bbox rethrows the upstream error', async () => {
  await withTempDir('openseamap-source-', async (dir) => {
    const first = createOpenSeaMapSource({ client: fakeClient().client, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status: silentStatus(), dataDir: dir })
    await first.listPointsOfInterest(sampleBbox, '')
    first.close()

    const staleServes: string[] = []
    const status: PluginStatus = { ...silentStatus(), recordStaleServe: (source) => staleServes.push(source) }
    const offlineClient: OverpassClient = {
      listPointsOfInterest: async () => { throw new Error('offline') },
      getById: async () => { throw new Error('offline') },
      listCoastlineWays: async () => [],
      close: () => {}
    }
    const second = createOpenSeaMapSource({ client: offlineClient, seamarkGroups: ['hazards'], minimumYear: 0, refreshSeconds: 0, status, dataDir: dir })
    // sampleBbox (0-1) contains none of the cached markers (lat 50-51), so there
    // is no offline data to serve and the upstream error propagates.
    await assert.rejects(() => second.listPointsOfInterest(sampleBbox, ''), /offline/)
    assert.deepEqual(staleServes, [], 'no stale serve is recorded when there is nothing cached to show')
    second.close()
  })
})
