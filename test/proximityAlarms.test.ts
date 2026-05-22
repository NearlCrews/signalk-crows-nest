import test from 'node:test'
import assert from 'node:assert/strict'
import { createProximityAlarms, type AlarmApp } from '../src/outputs/proximity-alarm/proximity-alarms.js'
import type { PoiSummary, PoiType, Position } from '../src/shared/types.js'

/** Shape of the notification value the alarms emit on the hazard path. */
interface CapturedNotification {
  path: string
  value: { state: string, method: string[], message: string, timestamp: string }
}

/** A mock AlarmApp that records every notification delta `handleMessage` sees. */
function createMockApp (): { app: AlarmApp, captured: CapturedNotification[] } {
  const captured: CapturedNotification[] = []
  const app: AlarmApp = {
    handleMessage: (_id, delta) => {
      const update = delta.updates?.[0]
      if (update !== undefined && 'values' in update) {
        for (const pathValue of update.values) {
          captured.push({
            path: String(pathValue.path),
            value: pathValue.value as CapturedNotification['value']
          })
        }
      }
    },
    debug: () => {}
  }
  return { app, captured }
}

/** Build a POI summary of the given type at the given position. */
function poi (id: string, type: PoiType, name: string, position: Position): PoiSummary {
  return { id, type, position, name }
}

/**
 * A position roughly `metersNorth` meters north of the origin. One degree of
 * latitude is about 111_320 m, which is precise enough to place test fixtures
 * comfortably inside or outside a radius.
 */
function northOfOrigin (metersNorth: number): Position {
  return { latitude: metersNorth / 111_320, longitude: 0 }
}

const ORIGIN: Position = { latitude: 0, longitude: 0 }

test('raises an alert for a hazard within the radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Submerged rock', northOfOrigin(100))])

  assert.equal(captured.length, 1)
  assert.equal(captured[0].path, 'notifications.navigation.activecaptain.hazard.h1')
  assert.equal(captured[0].value.state, 'alert')
  assert.deepEqual(captured[0].value.method, ['visual', 'sound'])
  assert.ok(captured[0].value.message.includes('Submerged rock'), 'message names the hazard')
  assert.ok(/\d+\s*m/.test(captured[0].value.message), 'message reports the distance')
  assert.ok(captured[0].value.timestamp.length > 0, 'a timestamp is present')
})

test('does not raise an alert for a hazard outside the radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Far rock', northOfOrigin(2000))])

  assert.equal(captured.length, 0)
})

test('ignores non-Hazard points of interest within the radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [
    poi('m1', 'Marina', 'Close marina', northOfOrigin(50)),
    poi('a1', 'Anchorage', 'Close anchorage', northOfOrigin(60))
  ])

  assert.equal(captured.length, 0)
})

test('does not re-fire while a hazard stays within the radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)
  const pois = [poi('h1', 'Hazard', 'Rock', northOfOrigin(100))]

  alarms.evaluate(ORIGIN, pois)
  alarms.evaluate(ORIGIN, pois)
  alarms.evaluate(ORIGIN, pois)

  assert.equal(captured.length, 1, 'the alarm is raised exactly once on entry')
  assert.equal(captured[0].value.state, 'alert')
})

test('clears the alarm exactly once when the hazard leaves the radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)
  const hazard = poi('h1', 'Hazard', 'Rock', northOfOrigin(100))

  // Enter the radius, then leave it (the vessel moved well away).
  alarms.evaluate(ORIGIN, [hazard])
  alarms.evaluate(northOfOrigin(5000), [hazard])
  alarms.evaluate(northOfOrigin(5000), [hazard])

  assert.equal(captured.length, 2, 'one alert on entry, one clear on exit')
  assert.equal(captured[0].value.state, 'alert')
  assert.equal(captured[1].value.state, 'normal')
  assert.equal(captured[1].path, 'notifications.navigation.activecaptain.hazard.h1')
  assert.ok(captured[1].value.message.includes('Rock'), 'the clear message names the hazard')
})

test('re-arms a hazard after it leaves and re-enters the radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)
  const hazard = poi('h1', 'Hazard', 'Rock', northOfOrigin(100))

  alarms.evaluate(ORIGIN, [hazard])
  alarms.evaluate(northOfOrigin(5000), [hazard])
  alarms.evaluate(ORIGIN, [hazard])

  assert.deepEqual(
    captured.map(entry => entry.value.state),
    ['alert', 'normal', 'alert']
  )
})

test('does not clear a hazard that was never alarmed', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)

  // The hazard is out of range on every pass, so it never enters the alarm
  // state and there is nothing to clear.
  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Far rock', northOfOrigin(2000))])
  alarms.evaluate(ORIGIN, [poi('h1', 'Hazard', 'Far rock', northOfOrigin(2000))])

  assert.equal(captured.length, 0)
})

test('tracks several hazards independently', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)
  const near = poi('near', 'Hazard', 'Near rock', northOfOrigin(100))
  const far = poi('far', 'Hazard', 'Far rock', northOfOrigin(3000))

  // First pass: only `near` is in range.
  alarms.evaluate(ORIGIN, [near, far])
  // Second pass: the vessel moved so `far` is now in range and `near` is not.
  alarms.evaluate(northOfOrigin(3000), [near, far])

  assert.equal(captured.length, 3)
  assert.equal(captured[0].path, 'notifications.navigation.activecaptain.hazard.near')
  assert.equal(captured[0].value.state, 'alert')
  // The second pass raises `far` and clears `near`, order independent.
  const secondPass = captured.slice(1)
  const farAlert = secondPass.find(entry => entry.path.endsWith('.far'))
  const nearClear = secondPass.find(entry => entry.path.endsWith('.near'))
  assert.equal(farAlert?.value.state, 'alert')
  assert.equal(nearClear?.value.state, 'normal')
})

test('applies a hysteresis band: an active alarm holds until past the exit radius', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)
  const hazard = poi('h1', 'Hazard', 'Rock', northOfOrigin(100))

  // Enter the 500 m raise radius.
  alarms.evaluate(ORIGIN, [hazard])
  assert.equal(captured.length, 1, 'the alarm is raised on entry')

  // 550 m away: outside the raise radius but inside the wider clear radius.
  alarms.evaluate(northOfOrigin(650), [hazard])
  assert.equal(captured.length, 1, 'the alarm holds inside the hysteresis band')

  // 700 m away: past the clear radius, so the alarm clears.
  alarms.evaluate(northOfOrigin(800), [hazard])
  assert.equal(captured.length, 2)
  assert.equal(captured[1].value.state, 'normal')
})

test('skips a hazard with a non-finite position instead of crashing', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)
  const bad = poi('bad', 'Hazard', 'Bad coords', { latitude: Number.NaN, longitude: 0 })
  const good = poi('good', 'Hazard', 'Real rock', northOfOrigin(100))

  assert.doesNotThrow(() => alarms.evaluate(ORIGIN, [bad, good]))
  assert.equal(captured.length, 1, 'only the well-formed hazard raises an alarm')
  assert.equal(captured[0].path, 'notifications.navigation.activecaptain.hazard.good')
})

test('sanitizes a POI id that carries path-breaking characters', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [poi('a.b/c', 'Hazard', 'Rock', northOfOrigin(100))])

  assert.equal(captured[0].path, 'notifications.navigation.activecaptain.hazard.a_b_c')
})

test('clearAll clears every active hazard exactly once', () => {
  const { app, captured } = createMockApp()
  const alarms = createProximityAlarms(app, 500)

  alarms.evaluate(ORIGIN, [
    poi('h1', 'Hazard', 'Rock one', northOfOrigin(100)),
    poi('h2', 'Hazard', 'Rock two', northOfOrigin(150))
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
