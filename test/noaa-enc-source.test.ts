/**
 * Tests for the NOAA ENC Direct PoiSource adapter.
 *
 * Uses a tiny fake `EncDirectClient` to drive `createNoaaEncSource`
 * deterministically: no live HTTP, no fixtures, no in-process server. The
 * feature shape mirrors the live ENC Direct wire (CATWRK as a decoded
 * string, WATLEV as a number, OBJNAM frequently null) so the adapter is
 * exercised against the same property bag the renderer handles in
 * `enc-direct-detail.test.ts`.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createNoaaEncSource } from '../src/inputs/noaa-enc/noaa-enc-source.js'
import type { EncFeature, EncLayerKey, ScaleBand } from '../src/inputs/noaa-enc/enc-direct-types.js'
import { getListProvenance } from '../src/inputs/poi-source.js'
import type { Bbox } from '../src/shared/types.js'
import { NOAA_ENC_SOURCE_ID } from '../src/shared/source-ids.js'
import { createStubStatus, withTempDir } from './helpers.js'

const namedWreck: EncFeature = {
  type: 'Feature',
  id: 12345,
  geometry: { type: 'Point', coordinates: [-71.0, 42.0] },
  properties: {
    OBJECTID: 12345,
    OBJNAM: 'SS Test',
    CATWRK: 'dangerous wreck',
    WATLEV: 3,
    VALSOU: 10,
    QUASOU: '6',
    TECSOU: null
  }
}

const unnamedObstruction: EncFeature = {
  type: 'Feature',
  id: 67890,
  geometry: { type: 'Point', coordinates: [-71.1, 42.1] },
  properties: {
    OBJECTID: 67890,
    OBJNAM: null,
    CATOBS: 'foul ground',
    WATLEV: 3,
    VALSOU: 8.2
  }
}

interface FakeClient {
  queryLayer: (request: { band: ScaleBand, layerKey: EncLayerKey, bbox: Bbox, signal?: AbortSignal }) => Promise<{ features: EncFeature[] }>
  queryById: (request: { band: ScaleBand, layerKey: EncLayerKey, objectId: number, signal?: AbortSignal }) => Promise<EncFeature | undefined>
}

test('listPointsOfInterest fans out across enabled layers and tags summaries', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      calls.push(layerKey)
      if (layerKey === 'wreck') return { features: [namedWreck] }
      if (layerKey === 'obstruction') return { features: [unnamedObstruction] }
      return { features: [] }
    },
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.deepEqual(calls.sort(), ['obstruction', 'wreck'])
  assert.equal(summaries.length, 2)
  for (const summary of summaries) {
    assert.equal(summary.source, NOAA_ENC_SOURCE_ID)
    assert.equal(summary.skIcon, 'hazard')
    assert.equal(summary.type, 'Hazard')
  }
  const wreck = summaries.find(s => s.name === 'SS Test')
  const obstruction = summaries.find(s => s.name === 'Obstruction')
  assert.ok(wreck !== undefined)
  assert.ok(obstruction !== undefined)
  // Coordinates are GeoJSON (lon, lat); the summary stores SignalK (lat, lon).
  assert.equal(wreck.position.latitude, 42.0)
  assert.equal(wreck.position.longitude, -71.0)
})

test('a partial layer failure is not cached, so the failed layer is retried on the next call', async () => {
  // One layer transiently fails while another succeeds. The source returns the
  // partial result for THIS call but must NOT cache it: caching would hide the
  // failed layer's POIs for the whole bbox-debounce window. The next call must
  // re-query so a recovered layer reappears promptly rather than after the TTL.
  let wreckCalls = 0
  let wreckFails = true
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      if (layerKey === 'wreck') {
        wreckCalls += 1
        if (wreckFails) throw new Error('arcgis 500')
        return { features: [namedWreck] }
      }
      return { features: [unnamedObstruction] }
    },
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 60, // caching ON: only the no-cache-on-partial rule lets the retry through
    status,
    getCurrentPosition: () => undefined
  })
  const bbox = { south: 41, west: -72, north: 43, east: -70 }
  const first = await source.listPointsOfInterest(bbox, '')
  assert.equal(first.length, 1, 'the partial result carries only the layer that succeeded')
  assert.equal(wreckCalls, 1)
  wreckFails = false
  const second = await source.listPointsOfInterest(bbox, '')
  assert.equal(wreckCalls, 2, 'the partial result was not cached, so the failed layer is retried')
  assert.equal(second.length, 2, 'the recovered wreck appears alongside the obstruction')
})

test('listPointsOfInterest only queries layers that are enabled', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      calls.push(layerKey)
      return { features: [] }
    },
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.deepEqual(calls, ['wreck'])
})

test('with no layers enabled the source returns a skipped empty list', async () => {
  let calls = 0
  const client: FakeClient = {
    queryLayer: async () => { calls++; return { features: [] } },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: false,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 0)
  assert.equal(calls, 0)
  assert.equal(getListProvenance(summaries), 'skipped')
  assert.ok(events.includes(`skipped:${NOAA_ENC_SOURCE_ID}:no ENC layers enabled`))
  source.close()
})

test('listPointsOfInterest skips outbound work when the vessel is outside US waters', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      calls.push(layerKey); return { features: [] }
    },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    // Mediterranean off Barcelona, decidedly not US waters.
    getCurrentPosition: () => ({ latitude: 41.38, longitude: 2.18 })
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 0)
  assert.equal(calls.length, 0)
  assert.ok(events.some(e => e.startsWith(`skipped:${NOAA_ENC_SOURCE_ID}`)))
})

test('close aborts an in-flight layer query without recording an outage', async () => {
  let requestStarted!: () => void
  const started = new Promise<void>((resolve) => { requestStarted = resolve })
  let requestSignal: AbortSignal | undefined
  const client: FakeClient = {
    queryLayer: async ({ signal }) => await new Promise((_resolve, reject) => {
      requestSignal = signal
      requestStarted()
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const pending = source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  await started
  source.close()
  await assert.rejects(() => pending, /source closed/)
  assert.equal(requestSignal?.aborted, true)
  assert.equal(events.filter(event => event.startsWith('error:')).length, 0)
})

test('listPointsOfInterest records a per-layer error when one layer query fails', async () => {
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      if (layerKey === 'wreck') return { features: [namedWreck] }
      throw new Error('upstream 500')
    },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].name, 'SS Test')
  assert.ok(events.some(e => e.startsWith(`error:${NOAA_ENC_SOURCE_ID}`)))
})

test('listPointsOfInterest rejects when every enabled layer query fails', async () => {
  // A total upstream outage must surface as a source-level rejection so the
  // aggregate registry's "any source succeeded" check trips and apiReachable
  // is NOT flipped to true via recordListFetch(0).
  const client: FakeClient = {
    queryLayer: async () => { throw new Error('upstream 500') },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  await assert.rejects(
    () => source.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, ''),
    /Every enabled NOAA ENC layer query failed/
  )
  // Per-layer errors were still recorded; only the aggregate-success path
  // changes when every layer fails.
  const errorEvents = events.filter(e => e.startsWith(`error:${NOAA_ENC_SOURCE_ID}`))
  assert.equal(errorEvents.length, 2, 'each failed layer recorded its own error')
})

test('getDetails on a cache hit serves the view, skips the upstream, and records no detail-success', async () => {
  // The cached path: (a) returns the prepared view, (b) makes no
  // queryById call, and (c) records no detail-success event (the cache
  // hit is not evidence of upstream reachability and must not flip a
  // stale apiReachable=false to true). All three properties of the
  // cache-hit branch in one test.
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [namedWreck] }),
    queryById: async () => { queryByIdCalls++; return namedWreck }
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  events.length = 0
  const view = await source.getDetails('wreck_12345')
  assert.equal(view.source, NOAA_ENC_SOURCE_ID)
  assert.equal(view.name, 'SS Test')
  assert.equal(view.type, 'Hazard')
  assert.equal(view.skIcon, 'hazard')
  assert.ok(view.description !== undefined)
  assert.ok(view.description.includes('dangerous wreck'))
  assert.ok(view.description.includes('not intended for primary navigation'))
  // The CC0 credit no longer rides inline in the description; it lives on
  // `properties.attribution` of the produced note (covered by the
  // note-builder tests). This source-level check confirms the inline
  // footer has been removed.
  assert.doesNotMatch(view.description, /crows-nest-attribution/)
  assert.equal(queryByIdCalls, 0, 'a cache hit must not re-query the upstream')
  assert.equal(
    events.filter(e => e.startsWith('detail-ok')).length, 0,
    'a cache hit must not record a detail success'
  )
})

test('getDetails records detail success only on a cache miss that hits the upstream', async () => {
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => namedWreck
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  await source.getDetails('wreck_99999')
  assert.ok(
    events.some(e => e === `detail-ok:${NOAA_ENC_SOURCE_ID}`),
    'a network-fetched detail records a detail success'
  )
})

test('close aborts an in-flight detail query without recording a result', async () => {
  let requestStarted!: () => void
  const started = new Promise<void>((resolve) => { requestStarted = resolve })
  let requestSignal: AbortSignal | undefined
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async ({ signal }) => await new Promise((_resolve, reject) => {
      requestSignal = signal
      requestStarted()
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const pending = source.getDetails('wreck_99999')
  await started
  source.close()
  await assert.rejects(() => pending, /source closed/)
  assert.equal(requestSignal?.aborted, true)
  assert.deepEqual(events, [])
})

test('getDetails fetches by objectId on a cache miss and caches the result', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async ({ objectId }) => {
      queryByIdCalls++
      return { ...namedWreck, id: objectId, properties: { ...namedWreck.properties, OBJECTID: objectId } }
    }
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const first = await source.getDetails('wreck_99999')
  const second = await source.getDetails('wreck_99999')
  assert.equal(first.name, 'SS Test')
  assert.equal(second.name, 'SS Test')
  assert.equal(queryByIdCalls, 1)
})

test('getDetails rejects when the upstream has no feature for the id', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => { queryByIdCalls++; return undefined }
  }
  const { status, events } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  await assert.rejects(() => source.getDetails('wreck_12junk'), /Malformed NOAA ENC id/)
  await assert.rejects(() => source.getDetails('wreck_0'), /Malformed NOAA ENC id/)
  assert.equal(queryByIdCalls, 0, 'malformed ids never reach ArcGIS')
  await assert.rejects(() => source.getDetails('wreck_404'), /wreck_404/)
  assert.equal(queryByIdCalls, 1)
  // The ArcGIS query answered normally, so the miss records a detail
  // success, never an error that would flip the status row to unreachable.
  assert.deepEqual(events, [`detail-ok:${NOAA_ENC_SOURCE_ID}`])
})

test('cacheSize reports the LRU entry count', async () => {
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      if (layerKey === 'wreck') return { features: [namedWreck] }
      if (layerKey === 'obstruction') return { features: [unnamedObstruction] }
      return { features: [] }
    },
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  try {
    assert.equal(source.cacheSize(), 0)
    await source.listPointsOfInterest(
      { south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(source.cacheSize(), 2)
  } finally {
    source.close()
  }
  // After close, cacheSize stays zero regardless of the in-try outcomes.
  assert.equal(source.cacheSize(), 0)
})

test('toSummary populates timestamp from SORDAT (YYYYMM)', async () => {
  const featureWithSordat: EncFeature = {
    ...namedWreck,
    properties: { ...namedWreck.properties, SORDAT: '201206' }
  }
  const client: FakeClient = {
    queryLayer: async () => ({ features: [featureWithSordat] }),
    queryById: async () => featureWithSordat
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 1)
  // Six-character SORDAT defaults to the first of the month, midnight UTC.
  assert.equal(summaries[0].timestamp, '2012-06-01T00:00:00.000Z')
})

test('toSummary populates timestamp from SORDAT (YYYYMMDD) and getDetails carries it too', async () => {
  const featureWithSordat: EncFeature = {
    ...namedWreck,
    properties: { ...namedWreck.properties, SORDAT: '20060915' }
  }
  const client: FakeClient = {
    queryLayer: async () => ({ features: [featureWithSordat] }),
    queryById: async () => featureWithSordat
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries[0].timestamp, '2006-09-15T00:00:00.000Z')
  const view = await source.getDetails(summaries[0].id)
  assert.equal(view.timestamp, '2006-09-15T00:00:00.000Z')
})

test('a feature with no SORDAT carries no timestamp and survives the year filter', async () => {
  const client: FakeClient = {
    queryLayer: async () => ({ features: [namedWreck] }),
    queryById: async () => namedWreck
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 2050,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 1, 'an undated feature is always kept')
  assert.equal(summaries[0].timestamp, undefined)
})

test('minimumYear drops features whose SORDAT year is below the threshold', async () => {
  const oldWreck: EncFeature = {
    ...namedWreck,
    id: 1,
    properties: { ...namedWreck.properties, OBJECTID: 1, SORDAT: '198001' }
  }
  const newWreck: EncFeature = {
    ...namedWreck,
    id: 2,
    properties: { ...namedWreck.properties, OBJECTID: 2, SORDAT: '202001' }
  }
  const client: FakeClient = {
    queryLayer: async () => ({ features: [oldWreck, newWreck] }),
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 2000,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 1, 'only the post-2000 wreck survives')
  assert.equal(summaries[0].id, 'wreck_2')
})

test('listPointsOfInterest reuses the bbox-cached result within refreshSeconds', async () => {
  // Fetches are counted per requested tile: the warm second call may also
  // prefetch neighbor tiles in the background (the edge-proximity warmup),
  // and those must not be mistaken for a re-fetch of the viewport itself.
  const fetchedTiles: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ bbox }) => {
      fetchedTiles.push(`${bbox.south}_${bbox.west}_${bbox.north}_${bbox.east}`)
      return { features: [namedWreck] }
    },
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 60,
    status,
    getCurrentPosition: () => undefined
  })
  const bbox = { south: 41, west: -72, north: 43, east: -70 }
  await source.listPointsOfInterest(bbox, '')
  await source.listPointsOfInterest(bbox, '')
  // The bbox is tile-aligned, so its snapped tile is itself.
  const viewportFetches = fetchedTiles.filter((tile) => tile === '41_-72_43_-70')
  assert.equal(viewportFetches.length, 1, 'the second call within the TTL hits the bbox cache')
})

test('listPointsOfInterest queries upstream every call when refreshSeconds is 0 (off)', async () => {
  let calls = 0
  const client: FakeClient = {
    queryLayer: async () => { calls++; return { features: [namedWreck] } },
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const bbox = { south: 41, west: -72, north: 43, east: -70 }
  await source.listPointsOfInterest(bbox, '')
  await source.listPointsOfInterest(bbox, '')
  assert.equal(calls, 2)
})

test('a listed feature survives a restart and renders offline from the on-disk store', async () => {
  await withTempDir('noaa-enc-source-', async (dir) => {
    // First run: list seeds the detail cache and persists to disk, then close
    // flushes the debounced write.
    const firstClient: FakeClient = {
      queryLayer: async ({ layerKey }) => layerKey === 'wreck' ? { features: [namedWreck] } : { features: [] },
      queryById: async () => undefined
    }
    const first = createNoaaEncSource({
      client: firstClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status: createStubStatus().status as never,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    await first.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, '')
    first.close()
    assert.ok(existsSync(join(dir, 'noaa-enc-cache.json')), 'the detail store is written on close')

    // Second run: the client is offline (queryById rejects), yet the previously
    // fetched feature renders from the hydrated store without any upstream call.
    let queryByIdCalls = 0
    const offlineClient: FakeClient = {
      queryLayer: async () => { throw new Error('offline') },
      queryById: async () => { queryByIdCalls++; throw new Error('offline') }
    }
    const second = createNoaaEncSource({
      client: offlineClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status: createStubStatus().status as never,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    assert.equal(second.cacheSize(), 1, 'the store hydrates the detail cache on a cold start')
    const view = await second.getDetails('wreck_12345')
    assert.equal(view.name, 'SS Test')
    assert.equal(view.type, 'Hazard')
    assert.equal(queryByIdCalls, 0, 'a hydrated feature is served without an upstream fetch')
    second.close()
  })
})

test('getDetails on a cache miss skips outbound HTTP when the vessel is outside US waters', async () => {
  // Mirrors the list-path gate: a detail click on a stale marker offshore must
  // not issue a NOAA request. The miss records a skip and behaves as a
  // not-found, and queryById is never called.
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => { queryByIdCalls++; return namedWreck }
  }
  const { events, status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    // Mediterranean off Barcelona, decidedly not US waters.
    getCurrentPosition: () => ({ latitude: 41.38, longitude: 2.18 })
  })
  await assert.rejects(() => source.getDetails('wreck_404'), /wreck_404/)
  assert.equal(queryByIdCalls, 0, 'no NOAA request is issued outside US waters')
  assert.ok(
    events.some(e => e.startsWith(`skipped:${NOAA_ENC_SOURCE_ID}`)),
    'the skip is recorded like the list path does'
  )
})

test('the summary url field points at OpenSeaMap with a marker at the feature lat/lon', async () => {
  // The previous NOAA ENC Direct URL format (`encdirect.noaa.gov/?center=...`)
  // loaded a blank page in the browser, so the source now produces an
  // OpenSeaMap marker URL instead.
  const client: FakeClient = {
    queryLayer: async () => ({ features: [namedWreck] }),
    queryById: async () => undefined
  }
  const { status } = createStubStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    refreshSeconds: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.ok(summaries[0].url.startsWith('https://map.openseamap.org/'))
  assert.ok(summaries[0].url.includes('mlat=42'))
  assert.ok(summaries[0].url.includes('mlon=-71'))
})

test('an offline list falls back to hydrated features within the bbox and records a stale serve', async () => {
  await withTempDir('noaa-enc-source-', async (dir) => {
    // First run seeds and persists the wreck feature (at lat 42, lon -71).
    const firstClient: FakeClient = {
      queryLayer: async ({ layerKey }) => layerKey === 'wreck' ? { features: [namedWreck] } : { features: [] },
      queryById: async () => undefined
    }
    const first = createNoaaEncSource({
      client: firstClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status: createStubStatus().status as never,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    await first.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, '')
    first.close()

    // Second run is offline: every layer query fails, so the source rebuilds the
    // marker from the hydrated detail cache and records a stale serve.
    const offlineClient: FakeClient = {
      queryLayer: async () => { throw new Error('offline') },
      queryById: async () => undefined
    }
    const { events, status } = createStubStatus()
    const second = createNoaaEncSource({
      client: offlineClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    const list = await second.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(list.length, 1, 'the previously fetched wreck reappears offline')
    assert.equal(list[0].id, 'wreck_12345')
    assert.ok(events.some(e => e === `stale:${NOAA_ENC_SOURCE_ID}:NOAA ENC unreachable`),
      'the offline serve is recorded as a stale serve, not a reachable fetch')
    second.close()
  })
})

test('an offline list with nothing cached inside the bbox rethrows the upstream error', async () => {
  await withTempDir('noaa-enc-source-', async (dir) => {
    const firstClient: FakeClient = {
      queryLayer: async ({ layerKey }) => layerKey === 'wreck' ? { features: [namedWreck] } : { features: [] },
      queryById: async () => undefined
    }
    const first = createNoaaEncSource({
      client: firstClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status: createStubStatus().status as never,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    await first.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, '')
    first.close()

    const offlineClient: FakeClient = {
      queryLayer: async () => { throw new Error('offline') },
      queryById: async () => undefined
    }
    const { events, status } = createStubStatus()
    const second = createNoaaEncSource({
      client: offlineClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    // A box far from the cached wreck (which is at lat 42, lon -71): no offline
    // data to serve, so the upstream failure propagates.
    await assert.rejects(
      () => second.listPointsOfInterest({ south: 0, west: 0, north: 1, east: 1 }, ''),
      /Every enabled NOAA ENC layer query failed/
    )
    assert.ok(!events.some(e => e.startsWith(`stale:${NOAA_ENC_SOURCE_ID}`)),
      'no stale serve is recorded when there is nothing cached to show')
    second.close()
  })
})

test('an offline list outside US waters skips without serving stale data, even with a populated store', async () => {
  await withTempDir('noaa-enc-source-', async (dir) => {
    // Seed and persist a wreck inside the query box while a fix is unknown so
    // the gate lets the fetch through.
    const seedClient: FakeClient = {
      queryLayer: async ({ layerKey }) => layerKey === 'wreck' ? { features: [namedWreck] } : { features: [] },
      queryById: async () => undefined
    }
    const seed = createNoaaEncSource({
      client: seedClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status: createStubStatus().status as never,
      getCurrentPosition: () => undefined,
      dataDir: dir
    })
    await seed.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, '')
    seed.close()

    // Now offline AND outside US waters. The store hydrates the cache, but the
    // US-waters gate precedes the offline fallback: the list returns [] with a
    // skip recorded, no upstream query is issued, and no stale serve is
    // recorded, so cached US data is never shown while offshore.
    let queryLayerCalls = 0
    const offlineClient: FakeClient = {
      queryLayer: async () => { queryLayerCalls++; throw new Error('offline') },
      queryById: async () => undefined
    }
    const { events, status } = createStubStatus()
    const offshore = createNoaaEncSource({
      client: offlineClient as never,
      band: 'coastal',
      includeWrecks: true,
      includeObstructions: false,
      includeRocks: false,
      minimumYear: 0,
      refreshSeconds: 0,
      status,
      // Mediterranean off Barcelona, decidedly not US waters.
      getCurrentPosition: () => ({ latitude: 41.38, longitude: 2.18 }),
      dataDir: dir
    })
    assert.equal(offshore.cacheSize(), 1, 'the store did hydrate a cached feature inside the box')
    const list = await offshore.listPointsOfInterest({ south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(list.length, 0, 'the gate returns empty offshore, never the cached US markers')
    assert.equal(queryLayerCalls, 0, 'no upstream query is issued offshore')
    assert.ok(events.some(e => e.startsWith(`skipped:${NOAA_ENC_SOURCE_ID}`)), 'the skip is recorded')
    assert.ok(!events.some(e => e.startsWith(`stale:${NOAA_ENC_SOURCE_ID}`)), 'no stale serve is recorded offshore')
    offshore.close()
  })
})
