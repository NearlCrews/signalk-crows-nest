/**
 * Tests for the USCG Local Notice to Mariners PoiSource adapter.
 *
 * The adapter wraps the HTTP client and the on-disk store in a PoiSource:
 * `listPointsOfInterest` filters the in-memory union by bbox, `getDetails`
 * reads from the union, and `refreshAll` iterates the pinned (layer, page)
 * files and gates the outbound HTTP on `isInUsWaters`. The store's union view
 * collapses NAVCEN's duplicate pages by record id, and its on-disk index
 * hydrates a cold start so previously fetched notices survive a restart.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUscgLnmSource } from '../src/inputs/uscg-lnm/uscg-lnm-source.js'
import { createLnmStore, type LnmStore } from '../src/inputs/uscg-lnm/lnm-store.js'
import { LNM_LAYER_PAGES } from '../src/inputs/uscg-lnm/lnm-layers.js'
import type { DownloadResult, LnmClient } from '../src/inputs/uscg-lnm/lnm-client.js'
import type { LnmRecord } from '../src/inputs/uscg-lnm/lnm-types.js'
import { USCG_LNM_SOURCE_ID } from '../src/shared/source-ids.js'
import { createStubStatus } from './helpers.js'

/** Build a notice record at the given position. */
function noticeRecord (id: number, lat: number, lon: number): LnmRecord {
  return {
    kind: 'notice',
    id: `haznav_${id}`,
    layer: 'haznav',
    position: { latitude: lat, longitude: lon },
    name: `Notice ${id}`,
    poiType: 'Hazard',
    skIcon: 'hazard',
    source: USCG_LNM_SOURCE_ID,
    timestamp: '2026-01-02T00:00:00.000Z',
    subCategory: 'Hazards To Navigation',
    noticeType: 'Shoaling Reported',
    description: 'Shoaling reported in the channel.'
  }
}

/** Build a discrepancy record at the given position with the given id. */
function discrepancyRecord (id: number, lat: number, lon: number): LnmRecord {
  return {
    kind: 'discrepancy',
    id: `discfedaid_${id}`,
    layer: 'discfedaid',
    position: { latitude: lat, longitude: lon },
    name: `Aid ${id}`,
    poiType: 'Hazard',
    skIcon: 'hazard',
    source: USCG_LNM_SOURCE_ID,
    status: 'LT EXT/OFF STATION',
    llnr: id
  }
}

/**
 * A stub client that answers each (layer, page) from `handler` and records the
 * calls it received, so a test can assert the refresh fan-out.
 */
function stubClient (
  handler: (slug: string, page: number) => DownloadResult
): { client: LnmClient, calls: Array<{ slug: string, page: number }> } {
  const calls: Array<{ slug: string, page: number }> = []
  const client: LnmClient = {
    downloadLayerPage: async (layer, page) => {
      calls.push({ slug: layer.slug, page })
      return handler(layer.slug, page)
    }
  }
  return { client, calls }
}

/** Boston Harbor: comfortably inside US waters. */
const BOSTON = { latitude: 42.36, longitude: -71.05 }

async function withStore (body: (store: LnmStore, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'lnm-src-'))
  try {
    const store = createLnmStore(dir)
    await store.load()
    await body(store, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('refreshAll iterates every pinned (layer, page) file and populates the store', async () => {
  await withStore(async (store) => {
    const { client, calls } = stubClient((slug, page) =>
      slug === 'haznav' && page === 1
        ? { status: 'ok', records: [noticeRecord(58, 42.4, -70.9)], headers: {} }
        : { status: 'not-modified' })
    const { status } = createStubStatus()
    const source = createUscgLnmSource({ client, store, status, getCurrentPosition: () => BOSTON })
    await source.refreshAll()
    assert.equal(calls.length, LNM_LAYER_PAGES.length,
      'refreshAll iterates every pinned (layer, page) pair exactly once')
    const summaries = await source.listPointsOfInterest(
      { south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(summaries.length, 1)
  })
})

test('listPointsOfInterest filters by bbox and tags every summary with the source', async () => {
  await withStore(async (store) => {
    store.upsertFile('haznav_1', [noticeRecord(58, 42.4, -70.9)], {})
    const { status } = createStubStatus()
    const source = createUscgLnmSource({ client: stubClient(() => ({ status: 'not-modified' })).client, store, status, getCurrentPosition: () => undefined })
    const inside = await source.listPointsOfInterest(
      { south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(inside.length, 1)
    const summary = inside[0]
    assert.equal(summary.source, USCG_LNM_SOURCE_ID)
    assert.equal(summary.id, 'haznav_58')
    assert.equal(summary.type, 'Hazard')
    assert.equal(summary.skIcon, 'hazard')
    assert.equal(summary.timestamp, '2026-01-02T00:00:00.000Z')
    assert.match(summary.url, /map\.openseamap\.org/)
    assert.match(summary.attribution, /NAVCEN/)
    const outside = await source.listPointsOfInterest({ south: 0, west: 0, north: 1, east: 1 }, '')
    assert.equal(outside.length, 0)
  })
})

test('getDetails renders the description and normalized sections, recording no status', async () => {
  await withStore(async (store) => {
    store.upsertFile('haznav_1', [noticeRecord(58, 42.4, -70.9)], {})
    const { events, status } = createStubStatus()
    const source = createUscgLnmSource({ client: stubClient(() => ({ status: 'not-modified' })).client, store, status, getCurrentPosition: () => undefined })
    const view = await source.getDetails('haznav_58')
    assert.equal(view.source, USCG_LNM_SOURCE_ID)
    assert.equal(view.type, 'Hazard')
    assert.ok(view.description !== undefined && view.description.includes('Shoaling reported'))
    assert.ok(view.sections !== undefined && view.sections.length > 0)
    assert.equal(view.timestamp, '2026-01-02T00:00:00.000Z')
    // A purely local serve records no reachability evidence, so a failing
    // refresh is not masked while a user clicks an already-loaded marker.
    assert.ok(!events.includes(`detail-ok:${USCG_LNM_SOURCE_ID}`))
  })
})

test('getDetails rejects for an unknown id', async () => {
  await withStore(async (store) => {
    const { status } = createStubStatus()
    const source = createUscgLnmSource({ client: stubClient(() => ({ status: 'not-modified' })).client, store, status, getCurrentPosition: () => undefined })
    await assert.rejects(() => source.getDetails('haznav_does-not-exist'))
  })
})

test('refreshAll skips outbound HTTP when the vessel is outside US waters', async () => {
  await withStore(async (store) => {
    const { client, calls } = stubClient(() => ({ status: 'not-modified' }))
    const { events, status } = createStubStatus()
    const source = createUscgLnmSource({
      client,
      store,
      status,
      // Sydney Harbour, decidedly not US.
      getCurrentPosition: () => ({ latitude: -33.85, longitude: 151.22 })
    })
    await source.refreshAll()
    assert.equal(calls.length, 0)
    assert.ok(events.some((event) => event.startsWith(`skipped:${USCG_LNM_SOURCE_ID}`)))
  })
})

test('refreshAll records an error status when a file download fails', async () => {
  await withStore(async (store) => {
    const { client } = stubClient(() => ({ status: 'error', message: 'HTTP 500' }))
    const { events, status } = createStubStatus()
    const source = createUscgLnmSource({ client, store, status, getCurrentPosition: () => BOSTON })
    await source.refreshAll()
    assert.ok(events.some((event) => event.startsWith(`error:${USCG_LNM_SOURCE_ID}`)))
  })
})

test('the store union collapses NAVCEN duplicate pages by record id', async () => {
  await withStore(async (store) => {
    // discFedAid page _2 is byte-identical to _1 on the live wire, so both
    // return the same record id; the union must count it once.
    const duplicate = discrepancyRecord(500, 25.8, -80.1)
    const { client } = stubClient((slug, page) =>
      slug === 'discfedaid' && page <= 3
        ? { status: 'ok', records: [duplicate], headers: {} }
        : { status: 'not-modified' })
    const { status } = createStubStatus()
    const source = createUscgLnmSource({ client, store, status, getCurrentPosition: () => BOSTON })
    await source.refreshAll()
    assert.equal(store.recordCount(), 1, 'three duplicate pages collapse to one record')
  })
})

test('upsertFile replaces a file record set, dropping an upstream-removed record from the union', async () => {
  await withStore(async (store) => {
    const a = noticeRecord(1001, 42.0, -71.0)
    const b = noticeRecord(1002, 42.1, -71.1)
    store.upsertFile('haznav_1', [a, b], {})
    assert.equal(store.recordCount(), 2)
    assert.ok(store.getById('haznav_1001') !== undefined)
    // A later refresh of the same file returns only B: A was removed upstream.
    // Replacing the file's whole record list must drop A from the union.
    store.upsertFile('haznav_1', [b], {})
    assert.equal(store.recordCount(), 1)
    assert.equal(store.getById('haznav_1001'), undefined)
    assert.ok(store.getById('haznav_1002') !== undefined)
  })
})

test('a persisted store hydrates a cold start, and a failed refresh keeps prior records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lnm-src-'))
  try {
    // First run: populate and flush to disk.
    const store1 = createLnmStore(dir)
    await store1.load()
    const { client: okClient } = stubClient((slug, page) =>
      slug === 'haznav' && page === 1
        ? { status: 'ok', records: [noticeRecord(58, 42.4, -70.9)], headers: { etag: '"v1"' } }
        : { status: 'not-modified' })
    const first = createUscgLnmSource({
      client: okClient,
      store: store1,
      status: createStubStatus().status,
      getCurrentPosition: () => BOSTON
    })
    await first.refreshAll()

    // Cold start: a fresh store loads the persisted index and serves the record
    // without any refresh, the offline-survival path.
    const store2 = createLnmStore(dir)
    await store2.load()
    const { client: errorClient } = stubClient(() => ({ status: 'error', message: 'offline' }))
    const second = createUscgLnmSource({
      client: errorClient,
      store: store2,
      status: createStubStatus().status,
      getCurrentPosition: () => BOSTON
    })
    const hydrated = await second.listPointsOfInterest(
      { south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(hydrated.length, 1, 'the persisted record hydrates a cold start')

    // A refresh that fails everywhere leaves the hydrated records intact.
    await second.refreshAll()
    const afterFailure = await second.listPointsOfInterest(
      { south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(afterFailure.length, 1, 'a failed refresh does not drop loaded records')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a refresh in flight when close() runs does not flush after stop', async () => {
  // On plugin stop the input module clears the scheduler timers and calls the
  // source's close while a refreshAll may still be running. That late refresh
  // must not flush onto a torn-down run's store at the same data dir.
  let flushes = 0
  let closed = false
  const fakeStore: LnmStore = {
    load: async () => {},
    upsertFile: () => {},
    headersFor: () => undefined,
    flush: async () => { if (!closed) flushes += 1 },
    queryBbox: () => [],
    getById: () => undefined,
    recordCount: () => 0,
    close: () => { closed = true }
  }
  const { client } = stubClient(() => ({ status: 'not-modified' }))
  const source = createUscgLnmSource({
    client,
    store: fakeStore,
    status: createStubStatus().status,
    getCurrentPosition: () => BOSTON
  })
  const pass = source.refreshAll()
  source.close()
  await pass
  assert.equal(flushes, 0, 'a refresh completing after close must not flush')
})
