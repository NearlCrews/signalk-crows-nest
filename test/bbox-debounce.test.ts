/**
 * Tests for the per-bbox geographic stale-while-revalidate cache.
 *
 * The cache snaps each viewport to a coarse tile grid (so nearby viewports
 * share a fetch), serves a stale entry immediately while revalidating it in the
 * background, and keys on the snapped tile plus an optional extraKey. The LRU
 * bounds size only; freshness is tracked against an injectable clock. These
 * tests cover snapping/reuse, the stale-while-revalidate path, the off
 * sentinel, the shouldCache veto, and clear().
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampBboxDebounceSeconds,
  createBboxDebounceCache,
  DEFAULT_BBOX_DEBOUNCE_SECONDS,
  MAX_BBOX_DEBOUNCE_SECONDS,
  MIN_BBOX_DEBOUNCE_SECONDS
} from '../src/shared/bbox-debounce.js'
import type { Bbox } from '../src/shared/types.js'

/** Flush pending microtasks so a fire-and-forget background refresh settles. */
function flush (): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

// Grid-aligned at 0.1 degrees, so it snaps to itself.
const SAMPLE: Bbox = { south: 42.0, west: -71.0, north: 42.5, east: -70.5 }
const ELSEWHERE: Bbox = { south: 37.7, west: -122.5, north: 37.9, east: -122.3 }

test('zero TTL disables the cache: every get calls the fetcher', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(0, 16)
  await cache.get(SAMPLE, async () => { calls++; return 1 })
  await cache.get(SAMPLE, async () => { calls++; return 1 })
  assert.equal(calls, 2)
})

test('a negative TTL is treated as zero (off)', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(-30, 16)
  await cache.get(SAMPLE, async () => { calls++; return 1 })
  await cache.get(SAMPLE, async () => { calls++; return 1 })
  assert.equal(calls, 2)
})

test('a positive TTL caches the result and returns it on the next get', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  const first = await cache.get(SAMPLE, async () => { calls++; return 42 })
  const second = await cache.get(SAMPLE, async () => { calls++; return 999 })
  assert.equal(first, 42)
  assert.equal(second, 42, 'the second get returns the cached value')
  assert.equal(calls, 1, 'the fetcher was called once')
})

test('different bboxes get independent cache slots', async () => {
  let aCalls = 0
  let bCalls = 0
  const cache = createBboxDebounceCache<string>(30, 16)
  await cache.get(SAMPLE, async () => { aCalls++; return 'a' })
  await cache.get(ELSEWHERE, async () => { bCalls++; return 'b' })
  await cache.get(SAMPLE, async () => { aCalls++; return 'a' })
  await cache.get(ELSEWHERE, async () => { bCalls++; return 'b' })
  assert.equal(aCalls, 1)
  assert.equal(bCalls, 1)
})

test('sub-pixel jitter on the bbox coordinates is collapsed to the same tile', async () => {
  // Two bboxes differing only in the 6th decimal place (about 11 cm) snap to
  // the same tile, so a Freeboard refresh that recomputes the bbox with
  // floating-point noise still hits the cache. The bbox sits mid-tile so the
  // jitter cannot cross a grid line (a grid-line crossing is the accepted
  // cliff, covered separately below).
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  const midTile: Bbox = { south: 42.03, west: -71.03, north: 42.47, east: -70.53 }
  await cache.get(midTile, async () => { calls++; return 1 })
  const jittered: Bbox = {
    south: 42.030001, west: -71.030001, north: 42.470001, east: -70.530001
  }
  await cache.get(jittered, async () => { calls++; return 2 })
  assert.equal(calls, 1)
})

test('two nearby viewports in the same tile share one upstream fetch', async () => {
  // Distinct viewports that both fall inside one 0.1-degree tile snap to the
  // same key, so a small pan that stays in the tile is an instant hit rather
  // than a fresh upstream round-trip.
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  const viewportA: Bbox = { south: 42.01, west: -71.04, north: 42.06, east: -70.96 }
  const viewportB: Bbox = { south: 42.03, west: -71.02, north: 42.08, east: -70.93 }
  await cache.get(viewportA, async () => { calls++; return 1 })
  await cache.get(viewportB, async () => { calls++; return 2 })
  assert.equal(calls, 1, 'both viewports snapped to the same tile')
})

test('a viewport that crosses a tile line fetches separately (the accepted cliff)', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  const below: Bbox = { south: 42.01, west: -71.04, north: 42.09, east: -70.96 }
  const across: Bbox = { south: 42.01, west: -71.04, north: 42.11, east: -70.96 }
  await cache.get(below, async () => { calls++; return 1 })
  await cache.get(across, async () => { calls++; return 2 })
  assert.equal(calls, 2, 'the north edge crossed the 42.1 grid line, a new tile')
})

test('a stale entry is served immediately and revalidated in the background', async () => {
  // Past the TTL the cache returns the last-known value at once (no blocking on
  // upstream) and kicks one background refresh that updates the entry, so the
  // next read sees the fresh value. An injected clock keeps it deterministic.
  let clock = 1000
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16, () => clock)
  assert.equal(await cache.get(SAMPLE, async () => { calls++; return calls }), 1)
  assert.equal(await cache.get(SAMPLE, async () => { calls++; return calls }), 1, 'fresh hit')
  assert.equal(calls, 1)

  clock += 31_000 // past the 30 s TTL
  const stale = await cache.get(SAMPLE, async () => { calls++; return calls })
  assert.equal(stale, 1, 'the stale value is served immediately')
  await flush() // let the background refresh settle
  assert.equal(calls, 2, 'a background refresh ran')
  assert.equal(
    await cache.get(SAMPLE, async () => { calls++; return calls }), 2,
    'the refreshed value is now served fresh'
  )
  assert.equal(calls, 2, 'the fresh read did not fetch again')
})

test('a non-cacheable (vetoed) result is returned but not cached, so the next call refetches', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<{ ok: boolean }>(30, 16)
  const first = await cache.get(SAMPLE, async () => { calls++; return { ok: false } }, undefined, (v) => v.ok)
  const second = await cache.get(SAMPLE, async () => { calls++; return { ok: true } }, undefined, (v) => v.ok)
  assert.equal(first.ok, false)
  assert.equal(second.ok, true)
  assert.equal(calls, 2, 'the vetoed result was not cached')
})

test('the off sentinel passes the raw viewport to the fetcher; on snaps to a superset', async () => {
  let offBbox: Bbox | undefined
  const off = createBboxDebounceCache<Bbox>(0, 16)
  await off.get(SAMPLE, async (fetchBbox) => { offBbox = fetchBbox; return fetchBbox })
  assert.deepEqual(offBbox, SAMPLE, 'off-sentinel fetches the raw viewport (no snap)')

  let onBbox: Bbox | undefined
  const on = createBboxDebounceCache<Bbox>(30, 16)
  const viewport: Bbox = { south: 42.01, west: -71.04, north: 42.06, east: -70.96 }
  await on.get(viewport, async (fetchBbox) => { onBbox = fetchBbox; return fetchBbox })
  assert.ok(onBbox !== undefined)
  assert.ok(
    onBbox.south <= viewport.south && onBbox.west <= viewport.west &&
    onBbox.north >= viewport.north && onBbox.east >= viewport.east,
    'the snapped fetch bbox is a superset of the viewport'
  )
})

test('clear() drops every entry, forcing the next get to re-fetch', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  await cache.get(SAMPLE, async () => { calls++; return 1 })
  cache.clear()
  await cache.get(SAMPLE, async () => { calls++; return 2 })
  assert.equal(calls, 2, 'the cleared entry was re-fetched')
})

test('the fetcher\'s rejection propagates without caching', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  await assert.rejects(() => cache.get(SAMPLE, async () => {
    calls++
    throw new Error('upstream down')
  }), /upstream down/)
  // A retry calls the fetcher again because the first failure was not cached.
  await assert.rejects(() => cache.get(SAMPLE, async () => {
    calls++
    throw new Error('still down')
  }), /still down/)
  assert.equal(calls, 2)
})

test('an extraKey discriminates cache entries for the same bbox', async () => {
  // The ActiveCaptain source passes `poiTypes` as the extraKey so a
  // notes-resource call without Hazard does not poison a later
  // proximity-alarm scan that needs Hazard.
  let marinaCalls = 0
  let hazardCalls = 0
  const cache = createBboxDebounceCache<string>(30, 16)
  await cache.get(SAMPLE, async () => { marinaCalls++; return 'marina' }, 'Marina')
  await cache.get(SAMPLE, async () => { hazardCalls++; return 'hazard' }, 'Hazard')
  const second = await cache.get(SAMPLE, async () => { marinaCalls++; return 'oops' }, 'Marina')
  assert.equal(marinaCalls, 1, 'Marina was fetched only once')
  assert.equal(hazardCalls, 1, 'Hazard was fetched separately')
  assert.equal(second, 'marina', 'the Marina key returned its own cached value')
})

test('omitting the extraKey shares the cache slot with another omitted call', async () => {
  let calls = 0
  const cache = createBboxDebounceCache<number>(30, 16)
  await cache.get(SAMPLE, async () => { calls++; return 1 })
  await cache.get(SAMPLE, async () => { calls++; return 2 })
  assert.equal(calls, 1)
})

test('clampBboxDebounceSeconds honors the range, falls back on garbage, and truncates', () => {
  assert.equal(clampBboxDebounceSeconds(0), MIN_BBOX_DEBOUNCE_SECONDS)
  assert.equal(clampBboxDebounceSeconds(45), 45)
  assert.equal(clampBboxDebounceSeconds(MAX_BBOX_DEBOUNCE_SECONDS + 100), MAX_BBOX_DEBOUNCE_SECONDS)
  assert.equal(clampBboxDebounceSeconds(-5), MIN_BBOX_DEBOUNCE_SECONDS)
  assert.equal(clampBboxDebounceSeconds(7.9), 7, 'truncates fractional seconds')
  assert.equal(clampBboxDebounceSeconds('30'), DEFAULT_BBOX_DEBOUNCE_SECONDS)
  assert.equal(clampBboxDebounceSeconds(Number.NaN), DEFAULT_BBOX_DEBOUNCE_SECONDS)
  assert.equal(clampBboxDebounceSeconds(undefined), DEFAULT_BBOX_DEBOUNCE_SECONDS)
})
