import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchListWithOfflineFallback,
  getListProvenance,
  staleSummariesWithinBbox,
  withListProvenance
} from '../src/inputs/poi-source.js'
import { createStubStatus } from './helpers.js'
import type { Bbox, PoiSummary } from '../src/shared/types.js'

/** A minimal PoiSummary for the stale-summaries and provenance helpers. */
function stubSummary (id: string, lat: number, lon: number): PoiSummary {
  return {
    id,
    type: 'Bridge',
    position: { latitude: lat, longitude: lon },
    name: id,
    source: 'test',
    url: `https://example.test/${id}`,
    attribution: 'test',
    skIcon: 'bridge'
  }
}

// ---------------------------------------------------------------------------
// fetchListWithOfflineFallback
// ---------------------------------------------------------------------------

test('fetchListWithOfflineFallback returns fresh on a successful upstream fetch', async () => {
  const { status } = createStubStatus()
  const outcome = await fetchListWithOfflineFallback(
    status, 'test-source', 'outage',
    async () => 'upstream data',
    () => []
  )
  assert.deepEqual(outcome, { kind: 'fresh', value: 'upstream data' })
  assert.equal(status.snapshot(0).sources.length, 0, 'status was not mutated by this helper')
})

test('fetchListWithOfflineFallback returns stale on failure when rebuild provides summaries', async () => {
  const { status, events } = createStubStatus()
  const summaries = [stubSummary('s1', 0, 0)]
  const outcome = await fetchListWithOfflineFallback(
    status, 'test-source', 'network down',
    async () => { throw new Error('offline') },
    () => summaries
  )
  assert.deepEqual(outcome, { kind: 'stale', summaries })
  assert.ok(events.some((e) => e.startsWith('stale:test-source:')),
    'a stale serve is recorded')
})

test('fetchListWithOfflineFallback propagates the error when rebuild returns an empty array', async () => {
  const { status } = createStubStatus()
  let failure: unknown
  try {
    await fetchListWithOfflineFallback(
      status, 'test-source', 'outage',
      async () => { throw new Error('boom') },
      () => []
    )
  } catch (error: unknown) {
    failure = error
  }
  assert.ok(failure instanceof Error)
  assert.equal((failure as Error).message, 'boom')
})

// ---------------------------------------------------------------------------
// staleSummariesWithinBbox
// ---------------------------------------------------------------------------

const bbox: Bbox = { north: 10, south: -10, east: 10, west: -10 }

test('staleSummariesWithinBbox builds summaries for values inside the bbox', () => {
  const value = { pos: { latitude: 0, longitude: 0 } }
  const result = staleSummariesWithinBbox(
    [value],
    bbox,
    (v) => v.pos,
    (v) => stubSummary('inside', v.pos.latitude, v.pos.longitude)
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'inside')
})

test('staleSummariesWithinBbox excludes values whose position is outside the bbox', () => {
  const values = [
    { pos: { latitude: 0, longitude: 0 } },
    { pos: { latitude: 20, longitude: 0 } }
  ]
  const result = staleSummariesWithinBbox(
    values,
    bbox,
    (v) => v.pos,
    (v) => stubSummary('out', v.pos.latitude, v.pos.longitude)
  )
  assert.equal(result.length, 1)
})

test('staleSummariesWithinBbox skips values whose positionOf returns undefined', () => {
  const values = [
    { pos: { latitude: 0, longitude: 0 } },
    { pos: undefined }
  ]
  const result = staleSummariesWithinBbox(
    values,
    bbox,
    (v) => v.pos,
    (v) => stubSummary('ok', (v.pos ?? { latitude: 0, longitude: 0 }).latitude, (v.pos ?? { latitude: 0, longitude: 0 }).longitude)
  )
  assert.equal(result.length, 1)
})

test('staleSummariesWithinBbox skips values whose toSummary returns null', () => {
  const values = [
    { pos: { latitude: 0, longitude: 0 } },
    { pos: { latitude: 1, longitude: 1 } }
  ]
  const result = staleSummariesWithinBbox(
    values,
    bbox,
    (v) => v.pos,
    (v) => v.pos.latitude > 0 ? null : stubSummary('ok', 0, 0)
  )
  assert.equal(result.length, 1)
})

test('staleSummariesWithinBbox returns an empty array for empty input', () => {
  const result = staleSummariesWithinBbox(
    [] as readonly { pos: { latitude: number, longitude: number } }[],
    bbox,
    (v) => v.pos,
    (v) => stubSummary('e', v.pos.latitude, v.pos.longitude)
  )
  assert.deepEqual(result, [])
})

// ---------------------------------------------------------------------------
// withListProvenance / getListProvenance
// ---------------------------------------------------------------------------

test('withListProvenance tags an array and getListProvenance reads it back', () => {
  const arr = [stubSummary('a', 0, 0), stubSummary('b', 1, 0)]
  const tagged = withListProvenance(arr, 'stale')
  assert.strictEqual(tagged, arr, 'withListProvenance returns the same array')
  assert.equal(getListProvenance(arr), 'stale')
  assert.equal(getListProvenance(tagged), 'stale')
})

test('getListProvenance returns fresh for an untagged array', () => {
  const arr = [stubSummary('a', 0, 0)]
  assert.equal(getListProvenance(arr), 'fresh')
})

test('withListProvenance supports all provenance values', () => {
  for (const provenance of ['fresh', 'local', 'skipped', 'stale'] as const) {
    const arr = [stubSummary('a', 0, 0)]
    withListProvenance(arr, provenance)
    assert.equal(getListProvenance(arr), provenance, `${provenance} round-trip`)
  }
})
