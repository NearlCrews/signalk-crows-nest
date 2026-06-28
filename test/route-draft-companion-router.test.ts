import test from 'node:test'
import assert from 'node:assert/strict'
import { toCompanionRequest, routeViaCompanion, getCompanionBridge, COMPANION_BRIDGE_KEY } from '../src/route-draft/channel-router/companion-router.js'
import { resolveChannelRoute } from '../src/route-draft/endpoint.js'

const baseReq = {
  from: { latitude: 37.8, longitude: -122.42 },
  to: { latitude: 37.79, longitude: -122.39 },
  draftMeters: 2,
  safetyMarginMeters: 0.5,
  standoffNm: 0.02,
  bboxAnchors: [{ latitude: 37.8, longitude: -122.42 }, { latitude: 37.79, longitude: -122.39 }],
  foreignRings: () => [],
  signal: AbortSignal.timeout(1000),
  deadlineMs: Date.now() + 5000,
}
const twoWaypoints = [{ latitude: 1, longitude: 2 }, { latitude: 1.1, longitude: 2.1 }]

test('toCompanionRequest is camelCase, drops the closure and signal, sets borderAware from homeCountryId', () => {
  const wire = toCompanionRequest(baseReq as never, 'USA')
  assert.equal(wire.draftMeters, 2)
  assert.equal(wire.homeCountryId, 'USA')
  assert.equal(wire.borderAware, true)
  assert.deepEqual(wire.bboxAnchors, baseReq.bboxAnchors)
  assert.ok(!('foreignRings' in wire))
  assert.ok(!('signal' in wire))
})

test('toCompanionRequest with no home country sets borderAware false and omits homeCountryId', () => {
  const wire = toCompanionRequest(baseReq as never, undefined)
  assert.equal(wire.borderAware, false)
  assert.ok(!('homeCountryId' in wire))
})

test('routeViaCompanion passes through a valid ok result', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: true, waypoints: twoWaypoints, usedTileWater: true, borderFallback: false }) }
  const r = await routeViaCompanion(bridge, baseReq as never, 'USA', 2000, 2000)
  assert.deepEqual(r, { ok: true, waypoints: twoWaypoints, usedTileWater: true, borderFallback: false })
})

test('routeViaCompanion passes through a typed decline', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: false, reason: 'no-coverage' }) }
  assert.deepEqual(await routeViaCompanion(bridge, baseReq as never, undefined, 2000, 2000), { ok: false, reason: 'no-coverage' })
})

test('routeViaCompanion returns null (fall back) on router-unavailable', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: false, reason: 'router-unavailable' }) }
  assert.equal(await routeViaCompanion(bridge, baseReq as never, undefined, 2000, 2000), null)
})

test('routeViaCompanion returns null on an unrecognized or malformed result', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: false, reason: 'totally-bogus' }) }
  assert.equal(await routeViaCompanion(bridge, baseReq as never, undefined, 2000, 2000), null)
  const bridge2 = { whenReady: async () => {}, routeOnWater: async () => ({ ok: true, waypoints: 'nope' }) }
  assert.equal(await routeViaCompanion(bridge2, baseReq as never, undefined, 2000, 2000), null)
})

test('routeViaCompanion returns null on a degenerate ok result of fewer than two waypoints', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: true, waypoints: [{ latitude: 1, longitude: 2 }], usedTileWater: false, borderFallback: false }) }
  assert.equal(await routeViaCompanion(bridge, baseReq as never, undefined, 2000, 2000), null)
})

test('routeViaCompanion returns null when whenReady rejects', async () => {
  const bridge = { whenReady: async () => { throw new Error('down') }, routeOnWater: async () => ({ ok: true, waypoints: twoWaypoints, usedTileWater: false, borderFallback: false }) }
  assert.equal(await routeViaCompanion(bridge, baseReq as never, undefined, 2000, 2000), null)
})

test('routeViaCompanion returns null when whenReady never resolves before the ready timeout', async () => {
  const bridge = { whenReady: () => new Promise<void>(() => {}), routeOnWater: async () => ({ ok: true, waypoints: twoWaypoints, usedTileWater: false, borderFallback: false }) }
  assert.equal(await routeViaCompanion(bridge, baseReq as never, undefined, 30, 2000), null)
})

test('routeViaCompanion returns null when routeOnWater hangs past the call timeout', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: () => new Promise<unknown>(() => {}) }
  assert.equal(await routeViaCompanion(bridge, baseReq as never, undefined, 2000, 30), null)
})

test('getCompanionBridge reads the global key and ignores a non-bridge value', () => {
  const g = globalThis as Record<string, unknown>
  delete g[COMPANION_BRIDGE_KEY]
  assert.equal(getCompanionBridge(), undefined)
  g[COMPANION_BRIDGE_KEY] = { whenReady: async () => {}, routeOnWater: async () => ({}) }
  assert.ok(getCompanionBridge())
  g[COMPANION_BRIDGE_KEY] = { not: 'a bridge' }
  assert.equal(getCompanionBridge(), undefined)
  delete g[COMPANION_BRIDGE_KEY]
})

// --- resolveChannelRoute strategy (companion first, in-process fallback) ---
const okBridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: true, waypoints: twoWaypoints, usedTileWater: false, borderFallback: false }) }
const baseOpts = { req: baseReq as never, homeCountryId: 'USA', readyTimeoutMs: 2000, minBudgetMs: 12_000, deadlineMs: 100_000, now: () => 0 }

test('resolveChannelRoute uses the companion when the bridge returns a result', async () => {
  const r = await resolveChannelRoute({ ...baseOpts, bridge: okBridge, runInProcess: async () => { throw new Error('should not run') } })
  assert.equal(r.ok, true)
})

test('resolveChannelRoute falls back to in-process when the bridge returns null', async () => {
  const bridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: false, reason: 'router-unavailable' }) }
  let ranInProcess = false
  const r = await resolveChannelRoute({ ...baseOpts, bridge, runInProcess: async () => { ranInProcess = true; return { ok: false, reason: 'no-path' } } })
  assert.equal(ranInProcess, true)
  assert.deepEqual(r, { ok: false, reason: 'no-path' })
})

test('resolveChannelRoute uses in-process when the bridge is absent (flag off gives undefined)', async () => {
  let ranInProcess = false
  await resolveChannelRoute({ ...baseOpts, bridge: undefined, runInProcess: async () => { ranInProcess = true; return { ok: false, reason: 'no-coverage' } } })
  assert.equal(ranInProcess, true)
})

test('resolveChannelRoute returns skipped when there is no budget up front', async () => {
  const r = await resolveChannelRoute({ ...baseOpts, deadlineMs: 1000, now: () => 0, bridge: undefined, runInProcess: async () => { throw new Error('no') } })
  assert.deepEqual(r, { ok: false, reason: 'skipped' })
})

test('resolveChannelRoute re-gates: a companion attempt that consumed the budget skips the in-process router', async () => {
  const clock = [0, 0, 95_000]
  let i = 0
  const nullBridge = { whenReady: async () => {}, routeOnWater: async () => ({ ok: false, reason: 'router-unavailable' }) }
  const r = await resolveChannelRoute({ ...baseOpts, deadlineMs: 100_000, now: () => clock[Math.min(i++, clock.length - 1)], bridge: nullBridge, runInProcess: async () => { throw new Error('should not run under budget') } })
  assert.deepEqual(r, { ok: false, reason: 'skipped' })
})
