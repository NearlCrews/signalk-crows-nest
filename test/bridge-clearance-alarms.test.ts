import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridgeClearanceAlarms } from '../src/outputs/bridge-air-draft/bridge-clearance-alarms.js'
import type { BridgeClearanceResolver } from '../src/outputs/bridge-air-draft/bridge-clearance-resolver.js'
import type { Position } from '../src/shared/types.js'
import { createCapturingApp, northOfOrigin, poiSummary as poi } from './helpers.js'

const ORIGIN: Position = { latitude: 0, longitude: 0 }

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

  alarms.evaluate(ORIGIN, [bridge])
  alarms.evaluate(ORIGIN, [bridge])

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

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Tall bridge', northOfOrigin(100))])

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

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Mystery bridge', northOfOrigin(100))])

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
  ])

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

  alarms.evaluate(ORIGIN, [poi('b1', 'Bridge', 'Low bridge', northOfOrigin(100))])

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

  alarms.evaluate(ORIGIN, [bridge])
  assert.equal(captured.length, 1, 'the alarm is raised while the air draft is known')

  airDraft = null
  alarms.evaluate(ORIGIN, [bridge])

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
  alarms.evaluate(ORIGIN, [bridge])
  alarms.evaluate(northOfOrigin(5000), [bridge])
  alarms.evaluate(northOfOrigin(5000), [bridge])

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
  alarms.evaluate(ORIGIN, [bridge])
  assert.equal(captured.length, 1, 'the alarm is raised on entry')

  // Bridge 550 m astern: outside the 500 m raise radius, inside the 600 m clear radius.
  alarms.evaluate(northOfOrigin(650), [bridge])
  assert.equal(captured.length, 1, 'the alarm holds inside the hysteresis band')

  // Bridge 700 m astern: past the clear radius, so the alarm clears.
  alarms.evaluate(northOfOrigin(800), [bridge])
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

  assert.doesNotThrow(() => alarms.evaluate(ORIGIN, [bad, good]))
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
  ])
  assert.equal(captured.length, 2, 'two alarms raised')

  alarms.clearAll()
  const clears = captured.slice(2)
  assert.equal(clears.length, 2, 'both alarms cleared')
  assert.ok(clears.every(entry => entry.value.state === 'normal'))

  // A second clearAll has nothing left to clear.
  alarms.clearAll()
  assert.equal(captured.length, 4)
})
