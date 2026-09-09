import test from 'node:test'
import assert from 'node:assert/strict'
import { createProximityAlarms } from '../src/outputs/proximity-alarm/proximity-alarms.js'
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

test('raises an alarm for a hazard within the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Submerged rock', northOfOrigin(100))], FETCHED_AT)

  assert.equal(captured.length, 1)
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.hazard.h1')
  assert.equal(captured[0].value.state, 'alarm')
  assert.deepEqual(captured[0].value.method, ['visual', 'sound'])
  assert.ok(captured[0].value.message.includes('Submerged rock'), 'message names the hazard')
  assert.ok(/\d+\s*m/.test(captured[0].value.message), 'message reports the distance')
  assert.ok(captured[0].value.createdAt.length > 0, 'a createdAt timestamp is present')
})

test('does not raise an alarm for a hazard outside the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Far rock', northOfOrigin(2000))], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('ignores non-Hazard points of interest within the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [
    poi('m1', 'Marina', 'Close marina', northOfOrigin(50)),
    poi('a1', 'Anchorage', 'Close anchorage', northOfOrigin(60))
  ], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('does not re-fire while a hazard stays within the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const pois = [poi('h1', 'Hazard', 'Rock', northOfOrigin(100))]

  alarms.evaluate(ORIGIN, pois, FETCHED_AT)
  alarms.evaluate(ORIGIN, pois, FETCHED_AT)
  alarms.evaluate(ORIGIN, pois, FETCHED_AT)

  assert.equal(captured.length, 1, 'the alarm is raised exactly once on entry')
  assert.equal(captured[0].value.state, 'alarm')
})

test('clears the alarm exactly once when the hazard leaves the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const hazard = poi('h1', 'Hazard', 'Rock', northOfOrigin(100))

  // Enter the radius, then leave it (the vessel moved well away).
  alarms.evaluate(ORIGIN, [hazard], FETCHED_AT)
  alarms.evaluate(northOfOrigin(5000), [hazard], FETCHED_AT)
  alarms.evaluate(northOfOrigin(5000), [hazard], FETCHED_AT)

  assert.equal(captured.length, 2, 'one alarm on entry, one clear on exit')
  assert.equal(captured[0].value.state, 'alarm')
  assert.equal(captured[1].value.state, 'normal')
  assert.equal(captured[1].path, 'notifications.navigation.crowsNest.hazard.h1')
  assert.ok(captured[1].value.message.includes('Rock'), 'the clear message names the hazard')
})

test('re-arms a hazard after it leaves and re-enters the radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const hazard = poi('h1', 'Hazard', 'Rock', northOfOrigin(100))

  alarms.evaluate(ORIGIN, [hazard], FETCHED_AT)
  alarms.evaluate(northOfOrigin(5000), [hazard], FETCHED_AT)
  alarms.evaluate(ORIGIN, [hazard], FETCHED_AT)

  assert.deepEqual(
    captured.map(entry => entry.value.state),
    ['alarm', 'normal', 'alarm']
  )
})

test('does not clear a hazard that was never alarmed', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  // The hazard is out of range on every pass, so it never enters the alarm
  // state and there is nothing to clear.
  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Far rock', northOfOrigin(2000))], FETCHED_AT)
  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Far rock', northOfOrigin(2000))], FETCHED_AT)

  assert.equal(captured.length, 0)
})

test('tracks several hazards independently', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const near = poi('near', 'Hazard', 'Near rock', northOfOrigin(100))
  const far = poi('far', 'Hazard', 'Far rock', northOfOrigin(3000))

  // First pass: only `near` is in range.
  alarms.evaluate(ORIGIN, [near, far], FETCHED_AT)
  // Second pass: the vessel moved so `far` is now in range and `near` is not.
  alarms.evaluate(northOfOrigin(3000), [near, far], FETCHED_AT)

  assert.equal(captured.length, 3)
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.hazard.near')
  assert.equal(captured[0].value.state, 'alarm')
  // The second pass raises `far` and clears `near`, order independent.
  const secondPass = captured.slice(1)
  const farAlarm = secondPass.find(entry => entry.path.endsWith('.far'))
  const nearClear = secondPass.find(entry => entry.path.endsWith('.near'))
  assert.equal(farAlarm?.value.state, 'alarm')
  assert.equal(nearClear?.value.state, 'normal')
})

test('applies a hysteresis band: an active alarm holds until past the exit radius', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const hazard = poi('h1', 'Hazard', 'Rock', northOfOrigin(100))

  // Enter the 500 m raise radius.
  alarms.evaluate(ORIGIN, [hazard], FETCHED_AT)
  assert.equal(captured.length, 1, 'the alarm is raised on entry')

  // 650 m away: outside the raise radius but inside the wider clear radius.
  alarms.evaluate(northOfOrigin(650), [hazard], FETCHED_AT)
  assert.equal(captured.length, 1, 'the alarm holds inside the hysteresis band')

  // 800 m away: past the clear radius, so the alarm clears.
  alarms.evaluate(northOfOrigin(800), [hazard], FETCHED_AT)
  assert.equal(captured.length, 2)
  assert.equal(captured[1].value.state, 'normal')
})

test('skips a hazard with a non-finite position instead of crashing', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const bad = poi('bad', 'Hazard', 'Bad coords', { latitude: Number.NaN, longitude: 0 })
  const good = poi('good', 'Hazard', 'Real rock', northOfOrigin(100))

  assert.doesNotThrow(() => alarms.evaluate(ORIGIN, [bad, good], FETCHED_AT))
  assert.equal(captured.length, 1, 'only the well-formed hazard raises an alarm')
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.hazard.good')
})

test('sanitizes a POI id that carries path-breaking characters', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [poi('a.b/c', 'Hazard', 'Rock', northOfOrigin(100))], FETCHED_AT)

  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.hazard.escaped.YS5iL2M')
})

test('unsafe and safe ids that previously collided raise and clear independently', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  // Two hazards on the same bearing at different ranges, so the vessel can
  // steam past one and clear it while the other is still inside the band.
  const dotted = poi('a.b', 'Hazard', 'Dotted rock', northOfOrigin(100))
  const scored = poi('a_b', 'Hazard', 'Scored rock', northOfOrigin(400))
  const both = [dotted, scored]
  alarms.evaluate(ORIGIN, both, FETCHED_AT)

  assert.deepEqual(captured.map(entry => entry.path), [
    'notifications.navigation.crowsNest.hazard.escaped.YS5i',
    'notifications.navigation.crowsNest.hazard.a_b'
  ])
  assert.ok(captured.every(entry => entry.value.state === 'alarm'))

  alarms.evaluate(northOfOrigin(1000), both, FETCHED_AT)
  assert.equal(captured.length, 3)
  assert.equal(captured[2].path, 'notifications.navigation.crowsNest.hazard.escaped.YS5i')
  assert.equal(captured[2].value.state, 'normal')

  alarms.evaluate(northOfOrigin(1100), both, FETCHED_AT)
  assert.equal(captured.length, 4)
  assert.equal(captured[3].path, 'notifications.navigation.crowsNest.hazard.a_b')
  assert.equal(captured[3].value.state, 'normal')
})

test('clearAll clears every active hazard exactly once', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [
    poi('h1', 'Hazard', 'Rock one', northOfOrigin(100)),
    poi('h2', 'Hazard', 'Rock two', northOfOrigin(150))
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

test('holds the alarm when a partial upstream result omits the hazard', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const wreck = poi('h1', 'Hazard', 'Wreck', northOfOrigin(111))
  const marina = poi('m1', 'Marina', 'Town quay', northOfOrigin(900))

  // Both sources answer, so the alarm goes up.
  alarms.evaluate(ORIGIN, [wreck, marina], FETCHED_AT)
  // The wreck's source times out; the aggregate ships the other source's
  // points on their own. The vessel has not moved.
  alarms.evaluate(ORIGIN, [marina], FETCHED_AT)
  // The source answers again on the next tick.
  alarms.evaluate(ORIGIN, [wreck, marina], FETCHED_AT)

  assert.deepEqual(captured.map(entry => entry.value.state), ['alarm'],
    'no clear and no second raise: nothing about the hazard changed')
})

test('a held alarm still clears once the vessel is clear of the hazard', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const wreck = poi('h1', 'Hazard', 'Wreck', northOfOrigin(111))

  alarms.evaluate(ORIGIN, [wreck], FETCHED_AT)
  // The source is still down, but the vessel has steamed well past the wreck,
  // which is the physical fact the alarm is about.
  alarms.evaluate(northOfOrigin(5000), [], FETCHED_AT)

  assert.deepEqual(captured.map(entry => entry.value.state), ['alarm', 'normal'])
  assert.ok(captured[1].value.message.includes('no longer nearby'))
})

test('a hazard nothing reports for the reconfirmation window is cleared as unreported', () => {
  let fetchedAt = FETCHED_AT
  const { app, captured } = createCapturingApp()
  const alarms = createProximityAlarms(app, 500)
  const wreck = poi('h1', 'Hazard', 'Wreck', northOfOrigin(111))

  alarms.evaluate(ORIGIN, [wreck], fetchedAt)
  fetchedAt += ALARM_RECONFIRM_WINDOW_MS
  alarms.evaluate(ORIGIN, [], fetchedAt)
  assert.equal(captured.length, 1, 'still held at the edge of the window')

  fetchedAt += 1
  alarms.evaluate(ORIGIN, [], fetchedAt)

  assert.equal(captured.length, 2)
  assert.equal(captured[1].value.state, 'normal')
  assert.ok(captured[1].value.message.includes('unreported for 30 minutes'))
  assert.ok(captured[1].value.message.includes('still within the alarm radius'),
    'the clear does not read as though the vessel had moved clear')
})
