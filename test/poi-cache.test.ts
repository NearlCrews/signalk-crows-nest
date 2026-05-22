import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPoiCache, type PoiDetailsSource } from '../src/inputs/active-captain/poi-cache.js'
import { createPoiStore } from '../src/inputs/active-captain/poi-store.js'
import type { PoiDetails } from '../src/shared/types.js'

/** Generous cache lifetime so entries never expire mid-test. */
const TTL_MINUTES = 60

/** Build a minimal but valid PoiDetails record for the given id. */
function makeDetails (id: string): PoiDetails {
  return {
    pointOfInterest: {
      id: Number(id),
      name: `POI ${id}`,
      poiType: 'Marina',
      mapLocation: { latitude: 0, longitude: 0 },
      dateLastModified: '2024-01-01T00:00:00Z'
    }
  }
}

/** A PoiDetailsSource that counts calls and can be told to fail the next loads. */
interface FakeSource extends PoiDetailsSource {
  callCount: () => number
}

function createFakeSource (failTimes = 0): FakeSource {
  let calls = 0
  let remainingFailures = failTimes
  return {
    pointOfInterestDetails: async (id: string): Promise<PoiDetails> => {
      calls++
      if (remainingFailures > 0) {
        remainingFailures--
        throw new Error('load failed')
      }
      return makeDetails(id)
    },
    callCount: () => calls
  }
}

test('get loads on a miss and calls the source once', async () => {
  const source = createFakeSource()
  const cache = createPoiCache(source, TTL_MINUTES)

  const details = await cache.get('1')

  assert.equal(details.pointOfInterest.name, 'POI 1')
  assert.equal(source.callCount(), 1)
})

test('a second get is served from cache without a second source call', async () => {
  const source = createFakeSource()
  const cache = createPoiCache(source, TTL_MINUTES)

  const first = await cache.get('1')
  const second = await cache.get('1')

  assert.deepEqual(second, first)
  assert.equal(source.callCount(), 1, 'expected the cached entry to be reused')
})

test('a rejected load rejects and is not cached, so the next get retries', async () => {
  const source = createFakeSource(1)
  const cache = createPoiCache(source, TTL_MINUTES)

  await assert.rejects(() => cache.get('1'), /load failed/)
  assert.equal(source.callCount(), 1)

  // The failed load was not cached: the next get hits the source again.
  const details = await cache.get('1')
  assert.equal(details.pointOfInterest.name, 'POI 1')
  assert.equal(source.callCount(), 2)
})

test('an entry past its in-memory TTL is reloaded from the source', async () => {
  const source = createFakeSource()
  // 0.001 minutes is a 60ms TTL: short enough to expire within the test.
  const cache = createPoiCache(source, 0.001)

  await cache.get('1')
  assert.equal(source.callCount(), 1)

  // Wait past the TTL window, then fetch again: the stale entry must trigger a
  // fresh load rather than serving an expired value.
  await new Promise(resolve => setTimeout(resolve, 90))

  const reloaded = await cache.get('1')
  assert.equal(reloaded.pointOfInterest.name, 'POI 1')
  assert.equal(source.callCount(), 2, 'expected the expired entry to be reloaded')
})

test('clear empties the cache so the next get reloads', async () => {
  const source = createFakeSource()
  const cache = createPoiCache(source, TTL_MINUTES)

  await cache.get('1')
  assert.equal(source.callCount(), 1)

  cache.clear()

  await cache.get('1')
  assert.equal(source.callCount(), 2, 'expected clear to force a reload')
})

test('the load listener fires only on a real load, not on a cache hit', async () => {
  const source = createFakeSource()
  let successes = 0
  let errors = 0
  const cache = createPoiCache(source, TTL_MINUTES, {
    onLoadSuccess: () => { successes++ },
    onLoadError: () => { errors++ }
  })

  await cache.get('1')
  await cache.get('1') // served from cache: must not notify again

  assert.equal(successes, 1, 'expected one load notification for the miss only')
  assert.equal(errors, 0)
})

test('the load listener reports a failed load', async () => {
  const source = createFakeSource(1)
  let successes = 0
  let errors = 0
  const cache = createPoiCache(source, TTL_MINUTES, {
    onLoadSuccess: () => { successes++ },
    onLoadError: () => { errors++ }
  })

  await assert.rejects(() => cache.get('1'), /load failed/)
  assert.equal(errors, 1)
  assert.equal(successes, 0)
})

/** Run a test body with a fresh temporary directory, removed afterwards. */
function withTempDir (body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'poi-cache-'))
  return body(dir).finally(() => { rmSync(dir, { recursive: true, force: true }) })
}

test('the cache hydrates from the persistent store on creation', async () => {
  await withTempDir(async (dir) => {
    // Seed the store directly, then build a cache pointed at the same store.
    const seedStore = createPoiStore(dir, TTL_MINUTES)
    seedStore.persist('1', makeDetails('1'))
    seedStore.flush()

    const source = createFakeSource()
    const cache = createPoiCache(source, TTL_MINUTES, {}, createPoiStore(dir, TTL_MINUTES))

    const details = await cache.get('1')

    assert.equal(details.pointOfInterest.name, 'POI 1')
    assert.equal(source.callCount(), 0, 'expected the hydrated entry to be served without a load')
    assert.equal(cache.size(), 1)
  })
})

test('a real load is persisted to the store and survives into a new cache', async () => {
  await withTempDir(async (dir) => {
    const firstSource = createFakeSource()
    const firstStore = createPoiStore(dir, TTL_MINUTES)
    const firstCache = createPoiCache(firstSource, TTL_MINUTES, {}, firstStore)
    await firstCache.get('1')
    assert.equal(firstSource.callCount(), 1)
    firstStore.flush() // force the debounced write out before a fresh cache reads it

    // A fresh cache over the same directory hydrates from what the first wrote.
    const secondSource = createFakeSource()
    const secondCache = createPoiCache(secondSource, TTL_MINUTES, {}, createPoiStore(dir, TTL_MINUTES))

    const details = await secondCache.get('1')

    assert.equal(details.pointOfInterest.name, 'POI 1')
    assert.equal(secondSource.callCount(), 0, 'expected the persisted entry to be reused')
  })
})

test('clear empties the persistent store as well as memory', async () => {
  await withTempDir(async (dir) => {
    const firstSource = createFakeSource()
    const firstCache = createPoiCache(firstSource, TTL_MINUTES, {}, createPoiStore(dir, TTL_MINUTES))
    await firstCache.get('1')
    firstCache.clear()

    // After a full clear, a fresh cache must find nothing to hydrate.
    const secondSource = createFakeSource()
    const secondCache = createPoiCache(secondSource, TTL_MINUTES, {}, createPoiStore(dir, TTL_MINUTES))

    assert.equal(secondCache.size(), 0)
    await secondCache.get('1')
    assert.equal(secondSource.callCount(), 1, 'expected clear to wipe the persisted store')
  })
})

test('a failed load is not persisted to the store', async () => {
  await withTempDir(async (dir) => {
    const source = createFakeSource(1)
    const cache = createPoiCache(source, TTL_MINUTES, {}, createPoiStore(dir, TTL_MINUTES))

    await assert.rejects(() => cache.get('1'), /load failed/)

    // Nothing should have been persisted, so a fresh cache stays empty.
    const fresh = createPoiCache(createFakeSource(), TTL_MINUTES, {}, createPoiStore(dir, TTL_MINUTES))
    assert.equal(fresh.size(), 0)
  })
})
