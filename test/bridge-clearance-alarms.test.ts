import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridgeClearanceAlarms } from '../src/outputs/bridge-air-draft/bridge-clearance-alarms.js'
import type { BridgeClearanceResolver } from '../src/outputs/bridge-air-draft/bridge-clearance-resolver.js'
import type { Position } from '../src/shared/types.js'
import { ALARM_RECONFIRM_WINDOW_MS } from '../src/outputs/alarm-retention.js'
import { createCapturingApp, northOfOrigin, poiSummary as poi } from './helpers.js'

const ORIGIN: Position = { latitude: 0, longitude: 0 }

/**
 * When the request behind the tick's list landed. Fixed except where the
 * reconfirmation window is what the test is about: the alarms only ever
 * compare it against the time a point was last listed at.
 */
const FETCHED_AT = 1_000_000

/** A resolver stub that records the id of every bridge it was asked about. */
function countingResolver (clearanceMeters: number | null): BridgeClearanceResolver & {
  resolved: () => string[]
  reset: () => void
} {
  let resolved: string[] = []
  return {
    clearanceMeters: (poi) => { resolved.push(poi.id); return clearanceMeters },
    close: () => {},
    resolved: () => resolved,
    reset: () => { resolved = [] }
  }
}

/** A resolver stub returning a fixed clearance, in meters, for every bridge. */
function fixedResolver (clearanceMeters: number | null): BridgeClearanceResolver {
  return { clearanceMeters: () => clearanceMeters, close: () => {} }
}

test('raises an alarm once for a too-low bridge within the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4), // 4 m clearance
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5 // 5 m air draft: 4 <= 5 + 1, so the bridge blocks
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))

  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)
  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)

  assert.equal(captured.length, 1, 'the alarm is raised exactly once on entry')
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.bridgeClearance.b1')
  assert.equal(captured[0].value.state, 'alarm')
  assert.deepEqual(captured[0].value.method, ['visual', 'sound'])
  assert.ok(captured[0].value.message.includes('Low bridge'), 'message names the bridge')
  assert.ok(captured[0].value.message.includes('4 m'), 'message reports the clearance')
  assert.ok(captured[0].value.message.includes('5 m'), 'message reports the air draft')
  assert.ok(captured[0].value.createdAt.length > 0, 'a createdAt timestamp is present')
})

test('does not raise an alarm for a bridge that clears the vessel', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(20), // 20 m clearance, well above the air draft
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Tall bridge', northOfOrigin(100))], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('does not raise an alarm when the bridge clearance is unknown', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(null), // clearance unknown
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Mystery bridge', northOfOrigin(100))], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('ignores non-Bridge points of interest within the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(1), // a clearance that would block, were this a bridge
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })

  alarms.evaluate(ORIGIN, [
    poi('h1', 'Hazard', 'Close rock', northOfOrigin(50)),
    poi('m1', 'Marina', 'Close marina', northOfOrigin(60))
  ], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('raises nothing when the vessel air draft is unknown', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => null // no design.airHeight and no fallback
  })

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('goes inert and clears an active alarm when the air draft disappears', () => {
  const { app, captured } = createCapturingApp()
  let airDraft: number | null = 5
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => airDraft
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))

  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)
  assert.equal(captured.length, 1, 'the alarm is raised while the air draft is known')

  airDraft = null
  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)

  assert.equal(captured.length, 2, 'the alarm clears when the air draft goes unknown')
  assert.equal(captured[1].value.state, 'normal')
})

test('clears the alarm exactly once when the bridge leaves the exit radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))

  // Enter the radius, then leave it well behind (the vessel motored on).
  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)
  alarms.evaluate(northOfOrigin(5000), [bridge], FETCHED_AT)
  alarms.evaluate(northOfOrigin(5000), [bridge], FETCHED_AT)

  assert.equal(captured.length, 2, 'one alarm on entry, one clear on exit')
  assert.equal(captured[0].value.state, 'alarm')
  assert.equal(captured[1].value.state, 'normal')
  assert.equal(captured[1].path, 'notifications.navigation.crowsNest.bridgeClearance.b1')
  assert.ok(captured[1].value.message.includes('Low bridge'), 'the clear message names the bridge')
})

test('holds the alarm through the hysteresis band until past the exit radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))

  // Enter the 500 m raise radius.
  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)
  assert.equal(captured.length, 1, 'the alarm is raised on entry')

  // Bridge 550 m astern: outside the 500 m raise radius, inside the 600 m clear radius.
  alarms.evaluate(northOfOrigin(650), [bridge], FETCHED_AT)
  assert.equal(captured.length, 1, 'the alarm holds inside the hysteresis band')

  // Bridge 700 m astern: past the clear radius, so the alarm clears.
  alarms.evaluate(northOfOrigin(800), [bridge], FETCHED_AT)
  assert.equal(captured.length, 2)
  assert.equal(captured[1].value.state, 'normal')
})

test('skips a bridge with a non-finite position instead of crashing', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const bad = poi('bad', 'Bridge', 'Bad coords', { latitude: Number.NaN, longitude: 0 })
  const good = poi('good', 'Bridge', 'Real bridge', northOfOrigin(100))

  assert.doesNotThrow(() => alarms.evaluate(ORIGIN, [bad, good], FETCHED_AT))
  assert.equal(captured.length, 1, 'only the well-formed bridge raises an alarm')
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.bridgeClearance.good')
})

test('clearAll clears every active bridge alarm exactly once', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })

  alarms.evaluate(ORIGIN, [
    poi('b1', 'Bridge', 'Bridge one', northOfOrigin(100)),
    poi('b2', 'Bridge', 'Bridge two', northOfOrigin(150))
  ], FETCHED_AT)
  assert.equal(captured.length, 2, 'two alarms raised')

  alarms.clearAll()
  const clears = captured.slice(2)
  assert.equal(clears.length, 2, 'both alarms cleared')
  assert.ok(clears.every(entry => entry.value.state === 'normal'))

  // A second clearAll has nothing left to clear.
  alarms.clearAll()
  assert.equal(captured.length, 4)
})

test('holds the alarm when a partial upstream result omits the bridge', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))
  const other = poi('b2', 'Bridge', 'Far bridge', northOfOrigin(4000))

  alarms.evaluate(ORIGIN, [bridge, other], FETCHED_AT)
  // The bridge's source times out; the vessel has not moved.
  alarms.evaluate(ORIGIN, [other], FETCHED_AT)
  alarms.evaluate(ORIGIN, [bridge, other], FETCHED_AT)

  assert.deepEqual(captured.map(entry => entry.value.state), ['alarm'],
    'no clear and no second raise: the bridge is still ahead')
})

test('a held bridge alarm still clears once the vessel is past it', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))], FETCHED_AT)
  alarms.evaluate(northOfOrigin(5000), [], FETCHED_AT)

  assert.deepEqual(captured.map(entry => entry.value.state), ['alarm', 'normal'])
  assert.ok(captured[1].value.message.includes('clearance alarm cleared'))
  assert.ok(!captured[1].value.message.includes('unreported'))
})

test('a bridge nothing reports for the reconfirmation window is cleared as unreported', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createBridgeClearanceAlarms(app, {
    resolver: fixedResolver(4),
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))], FETCHED_AT)
  alarms.evaluate(ORIGIN, [], FETCHED_AT + ALARM_RECONFIRM_WINDOW_MS + 1)

  assert.equal(captured.length, 2)
  assert.equal(captured[1].value.state, 'normal')
  assert.ok(captured[1].value.message.includes('unreported for 30 minutes'))
  assert.ok(captured[1].value.message.includes('still within the alarm radius'))
})

test('the resolver box is warmed once per list result, not once per replay', () => {
  const { app } = createCapturingApp()
  const resolver = countingResolver(20) // tall enough that nothing alarms
  const alarms = createBridgeClearanceAlarms(app, {
    resolver,
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const near = poi('near', 'Bridge', 'Near bridge', northOfOrigin(100))
  const far = poi('far', 'Bridge', 'Far bridge', northOfOrigin(3000))
  const pois = [near, far]

  // The tick's own result: every bridge in the box is resolved, so an
  // ActiveCaptain clearance is fetched well before the bridge is in range.
  alarms.evaluate(ORIGIN, pois, FETCHED_AT)
  assert.deepEqual(resolver.resolved().sort(), ['far', 'near'])

  // A replay of that result. The list has not changed, so only the bridge that
  // could alarm on this pass is resolved.
  resolver.reset()
  alarms.evaluate(ORIGIN, pois, FETCHED_AT)
  assert.deepEqual(resolver.resolved(), ['near'])

  // The next list request warms the whole box again.
  resolver.reset()
  alarms.evaluate(ORIGIN, pois, FETCHED_AT + 60_000)
  assert.deepEqual(resolver.resolved().sort(), ['far', 'near'])
})

test('a bridge that comes into range between list requests still alarms', () => {
  // The reason evaluation runs on every fix: a bridge can cross the alarm
  // radius between two list requests. Warming once per result must not cost
  // that bridge its alarm on the replay that first sees it in range.
  const { app, captured } = createCapturingApp()
  const resolver = countingResolver(4)
  const alarms = createBridgeClearanceAlarms(app, {
    resolver,
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(3000))

  // At the list request the bridge is 3 km ahead, well outside the radius.
  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)
  assert.equal(captured.length, 0, 'nothing in range yet')

  // The vessel closes on it; the same result is replayed against the new fix.
  resolver.reset()
  alarms.evaluate(northOfOrigin(2700), [bridge], FETCHED_AT)

  assert.deepEqual(resolver.resolved(), ['b1'], 'the bridge in range is resolved on the replay')
  assert.equal(captured.length, 1)
  assert.equal(captured[0].value.state, 'alarm')
})

test('a held bridge is resolved on a replay, so its alarm can still clear', () => {
  // A bridge held by retention is inside the radius by definition, so it stays
  // on the resolved path between list requests and keeps its clearance.
  const { app, captured } = createCapturingApp()
  const resolver = countingResolver(4)
  const alarms = createBridgeClearanceAlarms(app, {
    resolver,
    radiusMeters: 500,
    marginMeters: 1,
    getAirDraft: () => 5
  })
  const bridge = poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))

  alarms.evaluate(ORIGIN, [bridge], FETCHED_AT)
  assert.equal(captured.length, 1, 'raised while the list carried it')

  // The next result omits the bridge, so retention puts it back. The vessel
  // has since passed it, so the alarm clears on the geometry.
  resolver.reset()
  alarms.evaluate(northOfOrigin(1000), [], FETCHED_AT + 60_000)

  assert.deepEqual(captured.map(entry => entry.value.state), ['alarm', 'normal'])
  assert.ok(!captured[1].value.message.includes('unreported'))
})
