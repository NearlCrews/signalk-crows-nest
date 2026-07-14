/**
 * Tests for the USACE locks and dams PoiSource adapter.
 *
 * Uses a tiny fake `UsaceClient` to drive `createUsaceSource` deterministically:
 * no live HTTP, no fixtures, no in-process server. The feature shapes mirror the
 * live wire (lock PMSNAME, dam NAME, dimensions in feet) so the adapter is
 * exercised against the same property bags the renderers handle.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createUsaceSource } from '../src/inputs/usace/usace-source.js'
import type { UsaceFeature, UsaceLayerKey } from '../src/inputs/usace/usace-types.js'
import { getListProvenance } from '../src/inputs/poi-source.js'
import type { Bbox } from '../src/shared/types.js'
import { USACE_SOURCE_ID } from '../src/shared/source-ids.js'
import { createStubStatus, withTempDir } from './helpers.js'

const lock: UsaceFeature = {
  type: 'Feature',
  id: 203,
  geometry: { type: 'Point', coordinates: [-80.385, 40.648] },
  properties: {
    OBJECTID: 203,
    PMSNAME: 'MONTGOMERY LOCK & DAM',
    RIVER: 'OHIO',
    RIVERMI: 31.7,
    LENGTH: 600,
    WIDTH: 110,
    LIFT: 18,
    GATETYPE: 'Miter',
    YEAROPEN: 1936,
    STATE: 'PA'
  }
}

const dam: UsaceFeature = {
  type: 'Feature',
  id: 64270,
  geometry: { type: 'Point', coordinates: [-80.091, 40.474] },
  properties: {
    OBJECTID: 64270,
    NAME: 'Pine Hollow Detention',
    RIVER_OR_STREAM: 'TR OHIO RIVER',
    PRIMARY_PURPOSE: 'Flood Risk Reduction',
    DAM_HEIGHT: 22
  }
}

interface FakeClient {
  queryLayer: (request: { layerKey: UsaceLayerKey, bbox: Bbox, signal?: AbortSignal }) => Promise<{ features: UsaceFeature[] }>
  queryById: (request: { layerKey: UsaceLayerKey, objectId: number, signal?: AbortSignal }) => Promise<UsaceFeature | undefined>
}

const BOX: Bbox = { south: 40, west: -81, north: 41, east: -79 }

function makeSource (client: FakeClient, overrides: Partial<Parameters<typeof createUsaceSource>[0]> = {}): ReturnType<typeof createUsaceSource> {
  return createUsaceSource({
    client: client as never,
    includeLocks: true,
    includeDams: true,
    refreshSeconds: 0,
    status: createStubStatus().status as never,
    getCurrentPosition: () => undefined,
    ...overrides
  })
}

test('listPointsOfInterest fans out across enabled layers and tags summaries', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      calls.push(layerKey)
      if (layerKey === 'lock') return { features: [lock] }
      if (layerKey === 'dam') return { features: [dam] }
      return { features: [] }
    },
    queryById: async () => undefined
  }
  const source = makeSource(client)
  const summaries = await source.listPointsOfInterest(BOX, '')
  assert.deepEqual(calls.sort(), ['dam', 'lock'])
  assert.equal(summaries.length, 2)
  for (const summary of summaries) {
    assert.equal(summary.source, USACE_SOURCE_ID)
    assert.match(summary.attribution, /US Army Corps of Engineers/)
  }
  const lockSummary = summaries.find((s) => s.id === 'lock_203')
  const damSummary = summaries.find((s) => s.id === 'dam_64270')
  assert.ok(lockSummary !== undefined)
  assert.ok(damSummary !== undefined)
  assert.equal(lockSummary.type, 'Lock')
  assert.equal(lockSummary.skIcon, 'lock')
  assert.equal(lockSummary.name, 'MONTGOMERY LOCK & DAM')
  assert.equal(damSummary.type, 'Dam')
  assert.equal(damSummary.skIcon, 'dam')
  // Coordinates are GeoJSON (lon, lat); the summary stores SignalK (lat, lon).
  assert.equal(lockSummary.position.latitude, 40.648)
  assert.equal(lockSummary.position.longitude, -80.385)
})

test('listPointsOfInterest only queries layers that are enabled', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => { calls.push(layerKey); return { features: [] } },
    queryById: async () => undefined
  }
  const source = makeSource(client, { includeLocks: true, includeDams: false })
  await source.listPointsOfInterest(BOX, '')
  assert.deepEqual(calls, ['lock'])
})

test('with no layers enabled the source returns empty and queries nothing', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => { calls.push(layerKey); return { features: [] } },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, {
    includeLocks: false,
    includeDams: false,
    status: status as never
  })
  const summaries = await source.listPointsOfInterest(BOX, '')
  assert.equal(summaries.length, 0)
  assert.equal(calls.length, 0)
  assert.equal(getListProvenance(summaries), 'skipped')
  assert.ok(events.includes(`skipped:${USACE_SOURCE_ID}:no structure layers enabled`))
  source.close()
})

test('listPointsOfInterest skips outbound work when the vessel is outside US waters', async () => {
  const calls: string[] = []
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => { calls.push(layerKey); return { features: [] } },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, {
    status: status as never,
    // Mediterranean off Barcelona, decidedly not US waters.
    getCurrentPosition: () => ({ latitude: 41.38, longitude: 2.18 })
  })
  const summaries = await source.listPointsOfInterest(BOX, '')
  assert.equal(summaries.length, 0)
  assert.equal(calls.length, 0)
  assert.ok(events.some((e) => e.startsWith(`skipped:${USACE_SOURCE_ID}`)))
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
  const source = makeSource(client, {
    includeDams: false,
    status: status as never
  })
  const pending = source.listPointsOfInterest(BOX, '')
  await started
  source.close()
  await assert.rejects(() => pending, /source closed/)
  assert.equal(requestSignal?.aborted, true)
  assert.equal(events.filter(event => event.startsWith('error:')).length, 0)
})

test('listPointsOfInterest records a per-layer error when one layer query fails', async () => {
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      if (layerKey === 'lock') return { features: [lock] }
      throw new Error('arcgis 500')
    },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, { status: status as never })
  const summaries = await source.listPointsOfInterest(BOX, '')
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].id, 'lock_203')
  assert.ok(events.some((e) => e.startsWith(`error:${USACE_SOURCE_ID}`)))
})

test('listPointsOfInterest rejects when every enabled layer query fails', async () => {
  const client: FakeClient = {
    queryLayer: async () => { throw new Error('upstream 500') },
    queryById: async () => undefined
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, { status: status as never })
  await assert.rejects(
    () => source.listPointsOfInterest(BOX, ''),
    /Every enabled USACE layer query failed/
  )
  const errorEvents = events.filter((e) => e.startsWith(`error:${USACE_SOURCE_ID}`))
  assert.equal(errorEvents.length, 2, 'each failed layer recorded its own error')
})

test('getDetails serves a cache hit without re-querying and renders the detail', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => layerKey === 'lock' ? { features: [lock] } : { features: [] },
    queryById: async () => { queryByIdCalls++; return lock }
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, { includeDams: false, status: status as never })
  await source.listPointsOfInterest(BOX, '')
  events.length = 0
  const view = await source.getDetails('lock_203')
  assert.equal(view.type, 'Lock')
  assert.equal(view.name, 'MONTGOMERY LOCK & DAM')
  assert.ok(view.description !== undefined)
  assert.match(view.description, /182\.9 m long and 33\.5 m wide/)
  assert.ok(view.sections !== undefined && view.sections.length > 0)
  assert.equal(queryByIdCalls, 0, 'a cache hit must not re-query the upstream')
  assert.equal(
    events.filter((e) => e.startsWith('detail-ok')).length, 0,
    'a cache hit must not record a detail success'
  )
})

test('getDetails fetches by objectId on a cache miss, records success, and caches the result', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async ({ layerKey, objectId }) => {
      queryByIdCalls++
      assert.equal(layerKey, 'dam')
      assert.equal(objectId, 64270)
      return dam
    }
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, { status: status as never })
  const first = await source.getDetails('dam_64270')
  const second = await source.getDetails('dam_64270')
  assert.equal(first.name, 'Pine Hollow Detention')
  assert.equal(second.name, 'Pine Hollow Detention')
  assert.equal(queryByIdCalls, 1, 'the second call hits the cache')
  assert.ok(events.some((e) => e === `detail-ok:${USACE_SOURCE_ID}`))
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
  const source = makeSource(client, { status: status as never })
  const pending = source.getDetails('lock_203')
  await started
  source.close()
  await assert.rejects(() => pending, /source closed/)
  assert.equal(requestSignal?.aborted, true)
  assert.deepEqual(events, [])
})

test('getDetails rejects a malformed id and a missing feature', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => { queryByIdCalls++; return undefined }
  }
  const source = makeSource(client)
  await assert.rejects(() => source.getDetails('nope'), /Malformed USACE id/)
  await assert.rejects(() => source.getDetails('lock_12junk'), /Malformed USACE id/)
  await assert.rejects(() => source.getDetails('lock_0'), /Malformed USACE id/)
  assert.equal(queryByIdCalls, 0, 'malformed ids never reach ArcGIS')
  await assert.rejects(() => source.getDetails('lock_404'), /lock_404/)
  assert.equal(queryByIdCalls, 1)
})

test('getDetails on a cache miss skips outbound HTTP when the vessel is outside US waters', async () => {
  let queryByIdCalls = 0
  const client: FakeClient = {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => { queryByIdCalls++; return lock }
  }
  const { events, status } = createStubStatus()
  const source = makeSource(client, {
    status: status as never,
    getCurrentPosition: () => ({ latitude: 41.38, longitude: 2.18 })
  })
  await assert.rejects(() => source.getDetails('lock_404'), /lock_404/)
  assert.equal(queryByIdCalls, 0, 'no USACE request is issued outside US waters')
  assert.ok(events.some((e) => e.startsWith(`skipped:${USACE_SOURCE_ID}`)))
})

test('cacheSize reports the LRU entry count and drops to zero on close', async () => {
  const client: FakeClient = {
    queryLayer: async ({ layerKey }) => {
      if (layerKey === 'lock') return { features: [lock] }
      if (layerKey === 'dam') return { features: [dam] }
      return { features: [] }
    },
    queryById: async () => undefined
  }
  const source = makeSource(client)
  try {
    assert.equal(source.cacheSize(), 0)
    await source.listPointsOfInterest(BOX, '')
    assert.equal(source.cacheSize(), 2)
  } finally {
    source.close()
  }
  assert.equal(source.cacheSize(), 0)
})

test('a listed feature survives a restart and an offline list falls back to the hydrated store', async () => {
  await withTempDir('usace-source-', async (dir) => {
    // First run: list seeds and persists, close flushes the debounced write.
    const firstClient: FakeClient = {
      queryLayer: async ({ layerKey }) => layerKey === 'lock' ? { features: [lock] } : { features: [] },
      queryById: async () => undefined
    }
    const first = makeSource(firstClient, { includeDams: false, dataDir: dir })
    await first.listPointsOfInterest(BOX, '')
    first.close()
    assert.ok(existsSync(join(dir, 'usace-cache.json')), 'the detail store is written on close')

    // Second run offline: every layer query fails, so the source rebuilds the
    // marker from the hydrated detail cache and records a stale serve.
    const offlineClient: FakeClient = {
      queryLayer: async () => { throw new Error('offline') },
      queryById: async () => undefined
    }
    const { events, status } = createStubStatus()
    const second = makeSource(offlineClient, { includeDams: false, status: status as never, dataDir: dir })
    assert.equal(second.cacheSize(), 1, 'the store hydrates the detail cache on a cold start')
    const list = await second.listPointsOfInterest(BOX, '')
    assert.equal(list.length, 1, 'the previously fetched lock reappears offline')
    assert.equal(list[0].id, 'lock_203')
    assert.ok(events.some((e) => e === `stale:${USACE_SOURCE_ID}:USACE unreachable`),
      'the offline serve is recorded as a stale serve, not a reachable fetch')
    second.close()
  })
})
