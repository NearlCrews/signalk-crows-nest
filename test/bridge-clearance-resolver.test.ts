import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridgeClearanceResolver } from '../src/outputs/bridge-air-draft/bridge-clearance-resolver.js'
import { ACTIVE_CAPTAIN_SOURCE_ID, OPENSEAMAP_SOURCE_ID } from '../src/shared/source-ids.js'
import type { PoiDetailView, PoiSummary, PoiType } from '../src/shared/types.js'

/** Flush pending microtasks so a fire-and-forget getDetails settles. */
function flush (): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

interface BridgeOpts {
  id?: string
  source?: string
  type?: PoiType
  clearance?: number
}

function bridge (opts: BridgeOpts = {}): PoiSummary {
  const summary: PoiSummary = {
    id: opts.id ?? 'b1',
    type: opts.type ?? 'Bridge',
    position: { latitude: 0, longitude: 0 },
    name: 'Test bridge',
    source: opts.source ?? ACTIVE_CAPTAIN_SOURCE_ID,
    url: 'https://example.test/b1',
    attribution: 'test',
    skIcon: 'bridge'
  }
  if (opts.clearance !== undefined) summary.verticalClearanceMeters = opts.clearance
  return summary
}

function detail (clearance: number | undefined): PoiDetailView {
  const view: PoiDetailView = {
    name: 'Test bridge',
    position: { latitude: 0, longitude: 0 },
    type: 'Bridge',
    url: 'https://example.test/b1',
    source: ACTIVE_CAPTAIN_SOURCE_ID,
    attribution: 'test',
    skIcon: 'bridge'
  }
  if (clearance !== undefined) view.verticalClearanceMeters = clearance
  return view
}

test('returns a clearance already on the summary without any detail fetch', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; return detail(9) },
    debug: () => {}
  })
  assert.equal(resolver.clearanceMeters(bridge({ source: OPENSEAMAP_SOURCE_ID, clearance: 3.5 })), 3.5)
  await flush()
  assert.equal(calls, 0, 'a summary clearance must short-circuit the fetch')
})

test('fetches an ActiveCaptain bridge detail once, then serves it from cache', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async (id) => { calls += 1; assert.equal(id, 'ac1'); return detail(4.2) },
    debug: () => {}
  })
  const ac = bridge({ id: 'ac1' })
  assert.equal(resolver.clearanceMeters(ac), null, 'first tick: unknown, fetch started')
  await flush()
  assert.equal(resolver.clearanceMeters(ac), 4.2, 'second tick: served from cache')
  assert.equal(resolver.clearanceMeters(ac), 4.2)
  assert.equal(calls, 1, 'detail is fetched exactly once')
})

test('caches a detail with no clearance as null and does not refetch', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; return detail(undefined) },
    debug: () => {}
  })
  const ac = bridge({ id: 'ac2' })
  assert.equal(resolver.clearanceMeters(ac), null)
  await flush()
  assert.equal(resolver.clearanceMeters(ac), null, 'cached as no-clearance')
  assert.equal(calls, 1, 'a known no-clearance result is not refetched')
})

test('does not stack duplicate fetches while one is in flight', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; return detail(4.2) },
    debug: () => {}
  })
  const ac = bridge({ id: 'ac3' })
  resolver.clearanceMeters(ac)
  resolver.clearanceMeters(ac)
  resolver.clearanceMeters(ac)
  await flush()
  assert.equal(calls, 1, 'in-flight dedup collapses the burst into one fetch')
})

test('a fetch failure is not cached, so a later encounter retries', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; throw new Error('offline') },
    debug: () => {}
  })
  const ac = bridge({ id: 'ac4' })
  assert.equal(resolver.clearanceMeters(ac), null)
  await flush()
  assert.equal(resolver.clearanceMeters(ac), null, 'still unknown after a failed fetch')
  await flush()
  assert.ok(calls >= 2, 'a transient failure is retried on a later encounter')
})

test('re-resolves an ActiveCaptain clearance after its TTL so an upstream correction is picked up', async () => {
  // Without a TTL the resolver pins the first resolved clearance for the life
  // of the run, so a corrected ActiveCaptain bridge height (or one the detail
  // cache later refreshes) is never seen until a restart. An injectable clock
  // keeps the test deterministic with no real timers.
  let clock = 1000
  let upstream = 4.2
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; return detail(upstream) },
    debug: () => {},
    ttlMinutes: 10,
    now: () => clock
  })
  const ac = bridge({ id: 'ac5' })
  assert.equal(resolver.clearanceMeters(ac), null, 'first tick: unknown, fetch started')
  await flush()
  assert.equal(resolver.clearanceMeters(ac), 4.2, 'served from cache while fresh')
  assert.equal(calls, 1)

  // The bridge height is corrected upstream; advance time past the TTL.
  upstream = 3.0
  clock += 10 * 60 * 1000 + 1
  assert.equal(resolver.clearanceMeters(ac), 4.2, 'serves the stale value once while it revalidates')
  await flush()
  assert.equal(resolver.clearanceMeters(ac), 3.0, 'after the TTL the corrected clearance is picked up')
  assert.ok(calls >= 2, 'the stale entry triggered a re-fetch')
})

test('never fetches for a non-ActiveCaptain bridge with no summary clearance', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; return detail(4.2) },
    debug: () => {}
  })
  assert.equal(resolver.clearanceMeters(bridge({ source: OPENSEAMAP_SOURCE_ID })), null)
  await flush()
  assert.equal(calls, 0)
})

test('never fetches for a non-bridge ActiveCaptain POI', async () => {
  let calls = 0
  const resolver = createBridgeClearanceResolver({
    getDetails: async () => { calls += 1; return detail(4.2) },
    debug: () => {}
  })
  assert.equal(resolver.clearanceMeters(bridge({ type: 'Marina' })), null)
  await flush()
  assert.equal(calls, 0)
})
