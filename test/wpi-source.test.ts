/**
 * Tests for the NGA World Port Index PoiSource adapter.
 *
 * A tiny fake `WpiClient` drives `createWpiSource` deterministically: no live
 * HTTP, no fixtures, no in-process server. The World Port Index endpoint is a
 * full worldwide dump rather than a bbox query, so these tests exercise the
 * full-set fetch, the in-memory bbox filter, the refresh window (through an
 * injected clock), single-flight, the offline fallback, and disk persistence.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createWpiSource } from '../src/inputs/wpi/wpi-source.js'
import type { WpiPort } from '../src/inputs/wpi/wpi-types.js'
import type { Bbox } from '../src/shared/types.js'
import { WPI_SOURCE_ID } from '../src/shared/source-ids.js'
import { MAX_POI_CACHE_ENTRIES } from '../src/shared/cache.js'
import { createStubStatus, withTempDir } from './helpers.js'

const brooklyn: WpiPort = {
  portNumber: 7630,
  portName: 'Brooklyn',
  countryName: 'United States',
  xcoord: -74.0167,
  ycoord: 40.6667,
  harborSize: 'L',
  harborType: 'RN',
  shelter: 'E',
  chDepth: '13'
}

// Persian Gulf: worldwide coverage, but outside the New York bbox below.
const abadan: WpiPort = {
  portNumber: 48430,
  portName: 'Abadan',
  xcoord: 48.2833,
  ycoord: 30.3333,
  harborSize: 'M'
}

const NY_BBOX: Bbox = { south: 40, west: -75, north: 41, east: -73 }

interface FakeClient {
  fetchAllPorts: () => Promise<WpiPort[]>
}

test('listPointsOfInterest returns bbox-matching ports, tagged, and drops those outside', async () => {
  const client: FakeClient = { fetchAllPorts: async () => [brooklyn, abadan] }
  const { status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  const summaries = await source.listPointsOfInterest(NY_BBOX, '')
  assert.equal(summaries.length, 1, 'only the port inside the bbox is listed')
  const port = summaries[0]
  assert.equal(port.name, 'Brooklyn')
  assert.equal(port.source, WPI_SOURCE_ID)
  assert.equal(port.type, 'Marina')
  assert.equal(port.skIcon, 'marina')
  assert.match(port.attribution, /World Port Index/)
  assert.equal(port.position.latitude, 40.6667)
  assert.equal(port.position.longitude, -74.0167)
  assert.ok(port.url.startsWith('https://map.openseamap.org/'))
  assert.ok(port.url.includes('mlat=40.6667'))
})

test('a port with out-of-range coordinates is dropped from the list', async () => {
  const bad: WpiPort = { portNumber: 1, portName: 'Bad', xcoord: 999, ycoord: 40 }
  const client: FakeClient = { fetchAllPorts: async () => [brooklyn, bad] }
  const { status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  const summaries = await source.listPointsOfInterest(NY_BBOX, '')
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].id, '7630')
})

test('getDetails on a cache hit serves the view, skips the upstream, and records no detail-success', async () => {
  let fetches = 0
  const client: FakeClient = { fetchAllPorts: async () => { fetches++; return [brooklyn] } }
  const { events, status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  await source.listPointsOfInterest(NY_BBOX, '')
  events.length = 0
  const view = await source.getDetails('7630')
  assert.equal(view.name, 'Brooklyn')
  assert.equal(view.type, 'Marina')
  assert.equal(view.skIcon, 'marina')
  assert.ok(view.description?.includes('Large'))
  assert.ok(view.description?.includes('River, natural'))
  assert.ok(Array.isArray(view.sections) && view.sections.length > 0)
  assert.equal(fetches, 1, 'a cache hit does not re-fetch the full set')
  assert.equal(events.filter((e) => e.startsWith('detail-ok')).length, 0, 'a cache hit records no detail success')
})

test('getDetails on a cold cache miss fetches the set and records a detail success', async () => {
  let fetches = 0
  const client: FakeClient = { fetchAllPorts: async () => { fetches++; return [brooklyn] } }
  const { events, status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  const view = await source.getDetails('7630')
  assert.equal(view.name, 'Brooklyn')
  assert.equal(fetches, 1)
  assert.ok(events.some((e) => e === `detail-ok:${WPI_SOURCE_ID}`))
})

test('getDetails rejects for an unknown id after a normal refresh, recording success not error', async () => {
  const client: FakeClient = { fetchAllPorts: async () => [brooklyn] }
  const { events, status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  await assert.rejects(() => source.getDetails('99999'), /99999/)
  // The fetch answered normally, so the miss records a detail success and no error.
  assert.deepEqual(events, [`detail-ok:${WPI_SOURCE_ID}`])
})

test('a second list within the refresh window reuses the loaded set', async () => {
  const t = 1_000_000
  let fetches = 0
  const client: FakeClient = { fetchAllPorts: async () => { fetches++; return [brooklyn] } }
  const { status } = createStubStatus()
  const source = createWpiSource({
    client: client as never, refreshHours: 24, status: status as never, now: () => t
  })
  await source.listPointsOfInterest(NY_BBOX, '')
  await source.listPointsOfInterest(NY_BBOX, '')
  assert.equal(fetches, 1, 'the second call within the window does not re-fetch')
})

test('a list after the refresh window re-fetches the set', async () => {
  let t = 1_000_000
  let fetches = 0
  const client: FakeClient = { fetchAllPorts: async () => { fetches++; return [brooklyn] } }
  const { status } = createStubStatus()
  const source = createWpiSource({
    client: client as never, refreshHours: 1, status: status as never, now: () => t
  })
  await source.listPointsOfInterest(NY_BBOX, '')
  t += 60 * 60 * 1000 + 1 // one hour and a millisecond later
  await source.listPointsOfInterest(NY_BBOX, '')
  assert.equal(fetches, 2)
})

test('concurrent list calls share a single full-set fetch', async () => {
  let fetches = 0
  const client: FakeClient = { fetchAllPorts: async () => { fetches++; return [brooklyn] } }
  const { status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  await Promise.all([
    source.listPointsOfInterest(NY_BBOX, ''),
    source.listPointsOfInterest(NY_BBOX, '')
  ])
  assert.equal(fetches, 1, 'the second concurrent call joins the in-flight fetch')
})

test('cacheSize reports every loaded port and drops to zero after close', async () => {
  const client: FakeClient = { fetchAllPorts: async () => [brooklyn, abadan] }
  const { status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  try {
    assert.equal(source.cacheSize(), 0)
    await source.listPointsOfInterest(NY_BBOX, '')
    // The full set is loaded, not just the ports inside the bbox.
    assert.equal(source.cacheSize(), 2)
  } finally {
    source.close()
  }
  assert.equal(source.cacheSize(), 0)
})

test('the cache holds the whole worldwide index above the default ceiling without evicting', async () => {
  // Pins the raised WPI cap: more ports than the default detail-cache ceiling
  // must all survive, so a regression to the default (which is tuned for a
  // viewport, not a complete dataset) would evict part of the set and fail here.
  const count = MAX_POI_CACHE_ENTRIES + 1000
  const many: WpiPort[] = []
  for (let i = 0; i < count; i++) {
    many.push({ portNumber: i, portName: `Port ${i}`, xcoord: 0, ycoord: 0 })
  }
  const client: FakeClient = { fetchAllPorts: async () => many }
  const { status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  try {
    // The list call loads the full set into the cache; the bbox filter narrows
    // only the returned summaries, not what is retained.
    await source.listPointsOfInterest(NY_BBOX, '')
    assert.equal(source.cacheSize(), count, 'every port is retained above the default ceiling')
  } finally {
    source.close()
  }
})

test('a listed port survives a restart and renders offline from the on-disk store', async () => {
  await withTempDir('wpi-source-', async (dir) => {
    const online: FakeClient = { fetchAllPorts: async () => [brooklyn] }
    const first = createWpiSource({
      client: online as never, refreshHours: 24, status: createStubStatus().status as never, dataDir: dir
    })
    await first.listPointsOfInterest(NY_BBOX, '')
    first.close()
    assert.ok(existsSync(join(dir, 'wpi-cache.json')), 'the store is written on close')

    // Offline cold start: the client rejects, but the hydrated port still renders.
    let fetches = 0
    const offline: FakeClient = { fetchAllPorts: async () => { fetches++; throw new Error('offline') } }
    const second = createWpiSource({
      client: offline as never, refreshHours: 24, status: createStubStatus().status as never, dataDir: dir
    })
    assert.equal(second.cacheSize(), 1, 'the store hydrates the cache on a cold start')
    const view = await second.getDetails('7630')
    assert.equal(view.name, 'Brooklyn')
    assert.equal(fetches, 0, 'a hydrated port is served without an upstream fetch')
    second.close()
  })
})

test('an offline list falls back to hydrated ports within the bbox and records a stale serve', async () => {
  await withTempDir('wpi-source-', async (dir) => {
    const online: FakeClient = { fetchAllPorts: async () => [brooklyn] }
    const first = createWpiSource({
      client: online as never, refreshHours: 24, status: createStubStatus().status as never, dataDir: dir
    })
    await first.listPointsOfInterest(NY_BBOX, '')
    first.close()

    const offline: FakeClient = { fetchAllPorts: async () => { throw new Error('offline') } }
    const { events, status } = createStubStatus()
    const second = createWpiSource({
      client: offline as never, refreshHours: 24, status: status as never, dataDir: dir
    })
    const list = await second.listPointsOfInterest(NY_BBOX, '')
    assert.equal(list.length, 1, 'the previously fetched port reappears offline')
    assert.equal(list[0].id, '7630')
    assert.ok(
      events.some((e) => e === `stale:${WPI_SOURCE_ID}:World Port Index unreachable`),
      'the offline serve is recorded as a stale serve'
    )
    second.close()
  })
})

test('an offline list with nothing cached inside the bbox rethrows the upstream error', async () => {
  await withTempDir('wpi-source-', async (dir) => {
    const online: FakeClient = { fetchAllPorts: async () => [brooklyn] }
    const first = createWpiSource({
      client: online as never, refreshHours: 24, status: createStubStatus().status as never, dataDir: dir
    })
    await first.listPointsOfInterest(NY_BBOX, '')
    first.close()

    const offline: FakeClient = { fetchAllPorts: async () => { throw new Error('offline') } }
    const { events, status } = createStubStatus()
    const second = createWpiSource({
      client: offline as never, refreshHours: 24, status: status as never, dataDir: dir
    })
    // A box far from Brooklyn: nothing hydrated to serve, so the failure propagates.
    await assert.rejects(
      () => second.listPointsOfInterest({ south: 0, west: 0, north: 1, east: 1 }, ''),
      /offline/
    )
    assert.ok(!events.some((e) => e.startsWith(`stale:${WPI_SOURCE_ID}`)), 'no stale serve when nothing is cached to show')
    second.close()
  })
})

test('close aborts an in-flight full-set download', async () => {
  // A fetch that never settles until its abort signal fires, so the download is
  // genuinely in-flight when close() runs. The fake honors the signal (rejecting
  // on abort) the way the real one-shot client does.
  let capturedSignal: AbortSignal | undefined
  const client = {
    fetchAllPorts: (signal?: AbortSignal): Promise<WpiPort[]> =>
      new Promise((_resolve, reject) => {
        capturedSignal = signal
        signal?.addEventListener('abort', () => reject(new Error('download aborted')))
      })
  }
  const { status } = createStubStatus()
  const source = createWpiSource({ client: client as never, refreshHours: 24, status: status as never })
  const listing = source.listPointsOfInterest(NY_BBOX, '')
  await Promise.resolve() // let the list reach the in-flight fetch
  assert.ok(capturedSignal !== undefined, 'the client fetch receives the source abort signal')
  assert.equal(capturedSignal?.aborted, false, 'the signal is not aborted before close')
  source.close()
  assert.equal(capturedSignal?.aborted, true, 'close() aborts the in-flight download signal')
  // The aborted fetch rejects with nothing cached to fall back on, so the list rejects.
  await assert.rejects(listing, /download aborted/)
})
