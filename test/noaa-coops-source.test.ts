/**
 * Tests for the NOAA CO-OPS PoiSource adapter.
 *
 * The adapter wraps the HTTP client and the on-disk store in a PoiSource:
 * `listPointsOfInterest` filters the in-memory index by bbox and by the enabled
 * station types; `getDetails` reads from the in-memory map; `refreshAll` fetches
 * each enabled station list and gates the outbound HTTP on `isInUsWaters`, so a
 * vessel outside US waters keeps its already-loaded index without issuing a
 * refresh.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createNoaaCoopsSource } from '../src/inputs/noaa-coops/noaa-coops-source.js'
import { createCoopsStore } from '../src/inputs/noaa-coops/coops-store.js'
import type { CoopsClient, CoopsDownloadResult } from '../src/inputs/noaa-coops/coops-client.js'
import type { CoopsStore } from '../src/inputs/noaa-coops/coops-store.js'
import type { CoopsStationRecord, CoopsStationType } from '../src/inputs/noaa-coops/noaa-coops-types.js'
import { NOAA_COOPS_SOURCE_ID } from '../src/shared/source-ids.js'
import { createStubStatus, withTempDir } from './helpers.js'

/** A client that answers every download with "not-modified". */
function idleClient (): CoopsClient {
  return { downloadStations: async (): Promise<CoopsDownloadResult> => ({ status: 'not-modified' }) }
}

function station (
  id: string,
  stationType: CoopsStationType,
  latitude = 42.0,
  longitude = -71.0
): CoopsStationRecord {
  return {
    id,
    stationType,
    name: `Station ${id}`,
    position: { latitude, longitude },
    source: 'noaacoops'
  }
}

const BOSTON = { latitude: 42.36, longitude: -71.05 }
const SYDNEY = { latitude: -33.85, longitude: 151.22 }
const WIDE_BBOX = { north: 50, south: 30, east: -60, west: -80 }

test('listPointsOfInterest filters by bbox and tags every summary with the source', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide')], {})
    const { status } = createStubStatus()
    const source = createNoaaCoopsSource({
      client: idleClient(),
      store,
      stationTypes: ['tide', 'current'],
      status,
      getCurrentPosition: () => undefined
    })
    const inside = await source.listPointsOfInterest(WIDE_BBOX, '')
    assert.equal(inside.length, 1)
    assert.equal(inside[0].source, NOAA_COOPS_SOURCE_ID)
    assert.equal(inside[0].id, 'tide_8447386')
    assert.equal(inside[0].type, 'Navigational')
    assert.equal(inside[0].skIcon, 'navigation-structure')
    assert.ok(inside[0].url.includes('stationhome.html?id=8447386'))

    const outside = await source.listPointsOfInterest({ north: 1, south: 0, east: 1, west: 0 }, '')
    assert.equal(outside.length, 0)
  })
})

test('listPointsOfInterest returns only the enabled station types', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide')], {})
    store.upsertType('current', [station('bh0101', 'current')], {})
    const { status } = createStubStatus()
    const source = createNoaaCoopsSource({
      client: idleClient(),
      store,
      stationTypes: ['tide'],
      status,
      getCurrentPosition: () => undefined
    })
    const summaries = await source.listPointsOfInterest(WIDE_BBOX, '')
    assert.equal(summaries.length, 1)
    assert.equal(summaries[0].id, 'tide_8447386')
  })
})

test('getDetails returns a rendered detail view without recording reachability', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('current', [{ ...station('bh0101', 'current'), state: 'MA', timezone: 'EST' }], {})
    const { events, status } = createStubStatus()
    const source = createNoaaCoopsSource({
      client: idleClient(),
      store,
      stationTypes: ['current'],
      status,
      getCurrentPosition: () => undefined
    })
    const view = await source.getDetails('current_bh0101')
    assert.equal(view.source, NOAA_COOPS_SOURCE_ID)
    assert.equal(view.type, 'Navigational')
    assert.ok(view.description !== undefined)
    assert.ok(view.description.includes('Current station'))
    assert.ok(view.description.includes('Station ID'))
    assert.ok(view.sections !== undefined && view.sections.length > 0)
    // A local serve records no reachability evidence, mirroring the USCG and
    // NOAA ENC cache-hit paths.
    assert.ok(!events.includes(`detail-ok:${NOAA_COOPS_SOURCE_ID}`))
  })
})

test('getDetails rejects for an unknown id', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    const { status } = createStubStatus()
    const source = createNoaaCoopsSource({
      client: idleClient(),
      store,
      stationTypes: ['tide'],
      status,
      getCurrentPosition: () => undefined
    })
    await assert.rejects(() => source.getDetails('tide_missing'))
  })
})

test('refreshAll skips outbound HTTP when the vessel is outside US waters', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    const { events, status } = createStubStatus()
    let calls = 0
    const client: CoopsClient = {
      downloadStations: async (): Promise<CoopsDownloadResult> => { calls++; return { status: 'not-modified' } }
    }
    const source = createNoaaCoopsSource({
      client,
      store,
      stationTypes: ['tide', 'current'],
      status,
      getCurrentPosition: () => SYDNEY
    })
    await source.refreshAll()
    assert.equal(calls, 0)
    assert.ok(events.some(event => event.startsWith(`skipped:${NOAA_COOPS_SOURCE_ID}`)))
  })
})

test('refreshAll fetches each enabled station type when the vessel is in US waters', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    const { status } = createStubStatus()
    const requested: CoopsStationType[] = []
    const client: CoopsClient = {
      downloadStations: async (stationType): Promise<CoopsDownloadResult> => {
        requested.push(stationType)
        return { status: 'ok', records: [station(`${stationType}-1`, stationType)], headers: {} }
      }
    }
    const source = createNoaaCoopsSource({
      client,
      store,
      stationTypes: ['tide', 'current'],
      status,
      getCurrentPosition: () => BOSTON
    })
    await source.refreshAll()
    assert.deepEqual(requested.sort(), ['current', 'tide'])
    assert.equal(store.recordCount(), 2)
  })
})

test('refreshAll records an error status when a download fails', async () => {
  await withTempDir('coops-src-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    const { events, status } = createStubStatus()
    const client: CoopsClient = {
      downloadStations: async (): Promise<CoopsDownloadResult> => ({ status: 'error', message: 'HTTP 500' })
    }
    const source = createNoaaCoopsSource({
      client,
      store,
      stationTypes: ['tide'],
      status,
      getCurrentPosition: () => BOSTON
    })
    await source.refreshAll()
    assert.ok(events.some(event => event.startsWith(`error:${NOAA_COOPS_SOURCE_ID}`)))
  })
})

test('a refresh in flight when close() runs does not flush after stop', async () => {
  let flushes = 0
  let closed = false
  const fakeStore: CoopsStore = {
    load: async () => ({ generated: '', types: {}, records: {} }),
    upsertType: () => {},
    flush: async () => { if (!closed) flushes += 1 },
    snapshot: () => ({ generated: '', types: {}, records: {} }),
    recordCount: () => 0,
    queryBbox: () => [],
    close: () => { closed = true }
  }
  const { status } = createStubStatus()
  const source = createNoaaCoopsSource({
    client: idleClient(),
    store: fakeStore,
    stationTypes: ['tide'],
    status,
    getCurrentPosition: () => undefined
  })
  const pass = source.refreshAll()
  source.close()
  await pass
  assert.equal(flushes, 0, 'a refresh completing after close must not flush')
})
