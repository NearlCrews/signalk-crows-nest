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
import {
  createNoaaEncSource,
  NOAA_ENC_SOURCE_ID
} from '../src/inputs/noaa-enc/noaa-enc-source.js'
import type { EncFeature, EncLayerKey, ScaleBand } from '../src/inputs/noaa-enc/enc-direct-types.js'

interface FakeStatus {
  events: string[]
  status: {
    recordListFetch: (source: string, poiCount: number) => void
    recordDetailSuccess: (source: string) => void
    recordError: (source: string, message: string) => void
    recordSkipped: (source: string, reason: string) => void
    wasJustSkipped: (source: string) => boolean
    snapshot: () => unknown
  }
}

function fakeStatus (): FakeStatus {
  const events: string[] = []
  const skipped = new Set<string>()
  return {
    events,
    status: {
      recordListFetch: (source, count) => {
        events.push(`list-ok:${source}:${count}`)
        skipped.delete(source)
      },
      recordDetailSuccess: (source) => events.push(`detail-ok:${source}`),
      recordError: (source, message) => {
        events.push(`error:${source}:${message}`)
        skipped.delete(source)
      },
      recordSkipped: (source, reason) => {
        events.push(`skipped:${source}:${reason}`)
        skipped.add(source)
      },
      wasJustSkipped: (source) => skipped.has(source),
      snapshot: () => ({})
    }
  }
}

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
  queryLayer: (request: { band: ScaleBand, layerKey: EncLayerKey }) => Promise<{ features: EncFeature[] }>
  queryById: (request: { band: ScaleBand, layerKey: EncLayerKey, objectId: number }) => Promise<EncFeature | undefined>
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
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

test('listPointsOfInterest only queries layers that are enabled', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      calls.push(layerKey)
      return { features: [] }
    },
    queryById: async () => undefined
  }
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.deepEqual(calls, ['wreck'])
})

test('listPointsOfInterest skips outbound work when the vessel is outside US waters', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      calls.push(layerKey); return { features: [] }
    },
    queryById: async () => undefined
  }
  const { events, status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    // Mediterranean off Barcelona, decidedly not US waters.
    getCurrentPosition: () => ({ latitude: 41.38, longitude: 2.18 })
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 0)
  assert.equal(calls.length, 0)
  assert.ok(events.some(e => e.startsWith(`skipped:${NOAA_ENC_SOURCE_ID}`)))
})

test('listPointsOfInterest records a per-layer error when one layer query fails', async () => {
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      if (layerKey === 'wreck') return { features: [namedWreck] }
      throw new Error('upstream 500')
    },
    queryById: async () => undefined
  }
  const { events, status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
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
  const { events, status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
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

test('getDetails does NOT record detail success on a cache hit (apiReachable stays as-is)', async () => {
  // A cache hit is not evidence of upstream reachability: a stale
  // apiReachable=false must not flip to true purely because the user
  // clicked a previously loaded marker.
  const client: FakeClient = {
    queryLayer: async () => ({ features: [namedWreck] }),
    queryById: async () => namedWreck
  }
  const { events, status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  events.length = 0
  await source.getDetails('wreck_12345')
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
  const { events, status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  await source.getDetails('wreck_99999')
  assert.ok(
    events.some(e => e === `detail-ok:${NOAA_ENC_SOURCE_ID}`),
    'a network-fetched detail records a detail success'
  )
})

test('getDetails serves from the cache on hit and never re-queries the upstream', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [namedWreck] }),
    queryById: async () => { queryByIdCalls++; return namedWreck }
  }
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  const view = await source.getDetails('wreck_12345')
  assert.equal(view.source, NOAA_ENC_SOURCE_ID)
  assert.equal(view.name, 'SS Test')
  assert.equal(view.type, 'Hazard')
  assert.equal(view.skIcon, 'hazard')
  assert.ok(view.description !== undefined)
  assert.ok(view.description.includes('dangerous wreck'))
  assert.ok(view.description.includes('not intended for primary navigation'))
  // The CC0 attribution footer must be appended to the description.
  assert.ok(view.description.includes(view.attribution))
  assert.equal(queryByIdCalls, 0)
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  const first = await source.getDetails('wreck_99999')
  const second = await source.getDetails('wreck_99999')
  assert.equal(first.name, 'SS Test')
  assert.equal(second.name, 'SS Test')
  assert.equal(queryByIdCalls, 1)
})

test('getDetails rejects when the upstream has no feature for the id', async () => {
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => undefined
  }
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  await assert.rejects(() => source.getDetails('wreck_404'), /wreck_404/)
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: true,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 0,
    status: status as never,
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 2050,
    status: status as never,
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
  const { status } = fakeStatus()
  const source = createNoaaEncSource({
    client: client as never,
    band: 'coastal',
    includeWrecks: true,
    includeObstructions: false,
    includeRocks: false,
    minimumYear: 2000,
    status: status as never,
    getCurrentPosition: () => undefined
  })
  const summaries = await source.listPointsOfInterest(
    { south: 41, west: -72, north: 43, east: -70 }, '')
  assert.equal(summaries.length, 1, 'only the post-2000 wreck survives')
  assert.equal(summaries[0].id, 'wreck_2')
})
