/**
 * Tests for the USCG Light List PoiSource adapter.
 *
 * The adapter wraps the HTTP client and the on-disk store in a PoiSource:
 * `listPointsOfInterest` filters the in-memory index by bbox; `getDetails`
 * reads from the in-memory map; `refreshAll` iterates the (district, page)
 * pairs and gates the outbound HTTP on `isInUsWaters` so a vessel that has
 * left US waters keeps its already-loaded index without issuing a refresh.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createUscgLightListSource,
  DISTRICT_PAGES
} from '../src/inputs/uscg-light-list/uscg-light-list-source.js'
import { USCG_LIGHT_LIST_SOURCE_ID } from '../src/shared/source-ids.js'
import { createLightListStore } from '../src/inputs/uscg-light-list/light-list-store.js'
import type {
  DownloadResult,
  LightListClient
} from '../src/inputs/uscg-light-list/light-list-client.js'
import type { LightListStore } from '../src/inputs/uscg-light-list/light-list-store.js'
import type { LightListRecord } from '../src/inputs/uscg-light-list/light-list-types.js'
import { createStubStatus } from './helpers.js'

/** A fake client that defaults to "not-modified" for every download. */
function fakeClient (): LightListClient {
  return {
    downloadDistrict: async (): Promise<DownloadResult> => ({ status: 'not-modified' })
  }
}

function sampleRecord (overrides: Partial<LightListRecord> = {}): LightListRecord {
  return {
    llnr: 12345,
    name: 'Test Light',
    position: { latitude: 42.0, longitude: -71.0 },
    district: 'D01',
    volume: 1,
    source: 'usclightlist',
    inactive: false,
    ...overrides
  }
}

function loadOne (store: LightListStore, record: LightListRecord = sampleRecord()): void {
  store.upsertDistrict('D01', 1, [record], {})
}

test('a refresh in flight when close() runs does not flush after stop', async () => {
  // On plugin stop (or a config-change restart) the input module clears the
  // scheduler timers and calls the source's close while a refreshAll may still
  // be running. That late refresh must not flush onto a torn-down (or a freshly
  // restarted) run's store at the same data dir. A fake store counts flushes.
  let flushes = 0
  let closed = false
  const fakeStore: LightListStore = {
    load: async () => ({ generated: '', districts: {}, records: {} }),
    upsertDistrict: () => {},
    flush: async () => { if (!closed) flushes += 1 },
    snapshot: () => ({ generated: '', districts: {}, records: {} }),
    recordCount: () => 0,
    close: () => { closed = true },
    queryBbox: () => []
  }
  const { status } = createStubStatus()
  const source = createUscgLightListSource({
    client: fakeClient(),
    store: fakeStore,
    minimumYear: 0,
    status,
    getCurrentPosition: () => undefined
  })
  const pass = source.refreshAll() // fans out; suspends awaiting the downloads
  source.close() // stop while the refresh is in flight
  await pass
  assert.equal(flushes, 0, 'a refresh completing after close must not flush')
})

test('listPointsOfInterest filters by bbox and tags every summary with the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    loadOne(store)
    const { status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 0,
      status,
      getCurrentPosition: () => undefined
    })
    const inside = await source.listPointsOfInterest(
      { south: 41, west: -72, north: 43, east: -70 }, '')
    assert.equal(inside.length, 1)
    assert.equal(inside[0].source, USCG_LIGHT_LIST_SOURCE_ID)
    assert.equal(inside[0].id, '12345')
    assert.equal(inside[0].type, 'Navigational')
    assert.equal(inside[0].skIcon, 'navigation-structure')
    // The deep link points at OpenSeaMap with a marker at the record's
    // lat/lon; the canonical NAVCEN search-result deep link returns 404.
    assert.ok(inside[0].url.includes('map.openseamap.org'))
    assert.ok(inside[0].url.includes('mlat=42'))
    const outside = await source.listPointsOfInterest(
      { south: 0, west: 0, north: 1, east: 1 }, '')
    assert.equal(outside.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('getDetails returns a fully rendered detail view with attribution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    loadOne(store, sampleRecord({ remark: 'Visible 015° to 195°' }))
    const { events, status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 0,
      status,
      getCurrentPosition: () => undefined
    })
    const view = await source.getDetails('12345')
    assert.equal(view.source, USCG_LIGHT_LIST_SOURCE_ID)
    assert.equal(view.type, 'Navigational')
    assert.ok(view.description !== undefined)
    assert.ok(view.description.includes('Visible 015° to 195°'))
    // The credit no longer rides inline in the description; it lives on
    // `properties.attribution` of the produced note (covered by the
    // note-builder tests). This source-level check confirms the inline
    // footer has been removed.
    assert.doesNotMatch(view.description, /crows-nest-attribution/)
    // getDetails serves from the in-memory index with no HTTP, so it records
    // no reachability evidence: a local serve must not flip apiReachable and
    // mask a failing NAVCEN refresh. This mirrors the OpenSeaMap and NOAA ENC
    // cache-hit paths.
    assert.ok(!events.includes(`detail-ok:${USCG_LIGHT_LIST_SOURCE_ID}`))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('getDetails rejects for an unknown id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    const { status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 0,
      status,
      getCurrentPosition: () => undefined
    })
    await assert.rejects(() => source.getDetails('does-not-exist'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refreshAll skips outbound HTTP when the vessel is outside US waters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    const { events, status } = createStubStatus()
    let calls = 0
    const client: LightListClient = {
      downloadDistrict: async (): Promise<DownloadResult> => {
        calls++
        return { status: 'not-modified' }
      }
    }
    const source = createUscgLightListSource({
      client,
      store,
      minimumYear: 0,
      status,
      // Sydney Harbour, decidedly not US.
      getCurrentPosition: () => ({ latitude: -33.85, longitude: 151.22 })
    })
    await source.refreshAll()
    assert.equal(calls, 0)
    assert.ok(events.some(event => event.startsWith(`skipped:${USCG_LIGHT_LIST_SOURCE_ID}`)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refreshAll iterates every district page when the vessel is in US waters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    const { status } = createStubStatus()
    let calls = 0
    const client: LightListClient = {
      downloadDistrict: async (): Promise<DownloadResult> => {
        calls++
        return { status: 'not-modified' }
      }
    }
    const source = createUscgLightListSource({
      client,
      store,
      minimumYear: 0,
      status,
      // Boston Harbor.
      getCurrentPosition: () => ({ latitude: 42.36, longitude: -71.05 })
    })
    await source.refreshAll()
    // The source pins DISTRICT_PAGES exactly: a regression that shrank or
    // grew the table would change the iteration count, which a generous
    // upper bound would silently miss. Import the table and assert the
    // exact count instead.
    assert.equal(calls, DISTRICT_PAGES.length,
      'refreshAll iterates every pinned (district, page) pair exactly once')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refreshAll records an error status when a district download fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    const { events, status } = createStubStatus()
    const client: LightListClient = {
      downloadDistrict: async (): Promise<DownloadResult> =>
        ({ status: 'error', message: 'HTTP 500' })
    }
    const source = createUscgLightListSource({
      client,
      store,
      minimumYear: 0,
      status,
      // Boston Harbor.
      getCurrentPosition: () => ({ latitude: 42.36, longitude: -71.05 })
    })
    await source.refreshAll()
    assert.ok(events.some(event => event.startsWith(`error:${USCG_LIGHT_LIST_SOURCE_ID}`)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('summary carries timestamp when the record has modifiedDate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    loadOne(store, sampleRecord({ modifiedDate: '2020-06-15T00:00:00.000Z' }))
    const { status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 0,
      status,
      getCurrentPosition: () => undefined
    })
    const summaries = await source.listPointsOfInterest(
      { north: 50, south: 30, east: -60, west: -80 }, '')
    assert.equal(summaries.length, 1)
    assert.equal(summaries[0].timestamp, '2020-06-15T00:00:00.000Z')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('summary has no timestamp when the record has no modifiedDate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    loadOne(store)
    const { status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 0,
      status,
      getCurrentPosition: () => undefined
    })
    const summaries = await source.listPointsOfInterest(
      { north: 50, south: 30, east: -60, west: -80 }, '')
    assert.equal(summaries[0].timestamp, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('minimumYear drops records whose modifiedDate is older than the threshold', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    const oldRecord = sampleRecord({
      llnr: 100,
      name: 'Stale Daymark',
      modifiedDate: '1985-03-21T00:00:00.000Z'
    })
    const newRecord = sampleRecord({
      llnr: 200,
      name: 'Active Light',
      modifiedDate: '2022-01-10T00:00:00.000Z'
    })
    store.upsertDistrict('D01', 1, [oldRecord, newRecord], {})
    const { status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 2000,
      status,
      getCurrentPosition: () => undefined
    })
    const summaries = await source.listPointsOfInterest(
      { north: 50, south: 30, east: -60, west: -80 }, '')
    assert.equal(summaries.length, 1, 'only the post-2000 record survives')
    assert.equal(summaries[0].id, '200')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an undated record always survives the year filter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-src-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    loadOne(store)
    const { status } = createStubStatus()
    const source = createUscgLightListSource({
      client: fakeClient(),
      store,
      minimumYear: 2050,
      status,
      getCurrentPosition: () => undefined
    })
    const summaries = await source.listPointsOfInterest(
      { north: 50, south: 30, east: -60, west: -80 }, '')
    assert.equal(summaries.length, 1, 'an undated record is always kept')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('DISTRICT_PAGES matches the live NAVCEN per-district page coverage', () => {
  // Pinned from a direct probe of every district on navcen.uscg.gov: each
  // district publishes pages 1..max as contiguous lightListD{NN}_{n}.geojson
  // files. Locking the exact coverage here guards against the table silently
  // drifting behind NAVCEN (which previously dropped whole pages of aids) or
  // overreaching past the last published page (which would log 404s).
  const expectedMaxPage: Record<string, number> = {
    D01: 10, D02: 4, D05: 9, D07: 15, D08: 11, D09: 5, D11: 2, D13: 3, D14: 1, D17: 2
  }

  const expectedTotal = Object.values(expectedMaxPage).reduce((sum, max) => sum + max, 0)
  assert.equal(DISTRICT_PAGES.length, expectedTotal,
    `expected ${expectedTotal} (district, page) pairs across all districts`)

  const pagesByDistrict = new Map<string, number[]>()
  for (const [district, page] of DISTRICT_PAGES) {
    const pages = pagesByDistrict.get(district) ?? []
    pages.push(page)
    pagesByDistrict.set(district, pages)
  }

  assert.deepEqual([...pagesByDistrict.keys()].sort(), Object.keys(expectedMaxPage).sort(),
    'the table covers exactly the districts NAVCEN publishes (and no D03)')

  for (const [district, max] of Object.entries(expectedMaxPage)) {
    const pages = (pagesByDistrict.get(district) ?? []).slice().sort((a, b) => a - b)
    const contiguous = Array.from({ length: max }, (_unused, index) => index + 1)
    assert.deepEqual(pages, contiguous,
      `district ${district} should pin pages 1..${max} with no gaps or duplicates`)
  }
})
