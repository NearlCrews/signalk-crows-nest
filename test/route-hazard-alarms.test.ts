import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouteHazardAlarms } from '../src/outputs/route-hazard/route-hazard-alarms.js'
import type { CorridorPoi, PoiType } from '../src/shared/types.js'
import { createCapturingApp } from './helpers.js'

/** Build a flagged corridor POI with sensible defaults for the optional fields. */
function corridorPoi (
  id: string,
  type: PoiType,
  name: string,
  alongTrackDistanceMeters: number,
  etaSeconds?: number
): CorridorPoi {
  return {
    id,
    type,
    name,
    position: { latitude: 0, longitude: 0 },
    alongTrackDistanceMeters,
    crossTrackDistanceMeters: 0,
    etaSeconds
  }
}

test('raises a warn notification when a POI first appears on the route', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)

  alarms.evaluate([corridorPoi('h1', 'Hazard', 'Submerged rock', 800, 600)])

  assert.equal(captured.length, 1)
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.route.h1')
  assert.equal(captured[0].value.state, 'warn')
  assert.deepEqual(captured[0].value.method, ['visual'])
  assert.ok(captured[0].value.message.includes('Submerged rock'), 'message names the POI')
  assert.ok(captured[0].value.message.includes('Hazard'), 'message names the POI type')
  assert.ok(captured[0].value.message.includes('800 m'), 'message reports the along-track distance')
  assert.ok(captured[0].value.message.includes('ETA 10 min'), 'message reports the ETA')
  assert.ok(captured[0].value.createdAt.length > 0, 'a createdAt timestamp is present')
})

test('omits the ETA when the corridor POI carries no etaSeconds', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)

  alarms.evaluate([corridorPoi('b1', 'Bridge', 'Old swing bridge', 1500)])

  assert.equal(captured.length, 1)
  assert.ok(captured[0].value.message.includes('Bridge'), 'message names the POI type')
  assert.ok(!captured[0].value.message.includes('ETA'), 'no ETA when speed is unavailable')
})

test('formats an along-track distance of a kilometer or more in km', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)

  alarms.evaluate([corridorPoi('l1', 'Lock', 'Canal lock', 3400)])

  assert.ok(captured[0].value.message.includes('3.4 km'), 'a long distance is shown in km')
})

test('does not re-fire while a POI stays on the route ahead', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const pois = [corridorPoi('h1', 'Hazard', 'Rock', 800)]

  alarms.evaluate(pois)
  alarms.evaluate(pois)
  alarms.evaluate(pois)

  assert.equal(captured.length, 1, 'the alarm is raised exactly once on appearance')
  assert.equal(captured[0].value.state, 'warn')
})

test('refreshes the notification when the along-track distance or ETA changes', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)

  alarms.evaluate([corridorPoi('h1', 'Hazard', 'Rock', 1800, 600)])
  // The vessel has closed on the hazard: same POI, a shorter distance and ETA.
  alarms.evaluate([corridorPoi('h1', 'Hazard', 'Rock', 900, 300)])

  assert.equal(captured.length, 2, 'the notification is re-emitted with the updated figures')
  assert.equal(captured[1].value.state, 'warn')
  assert.ok(captured[1].value.message.includes('900 m'), 'the refreshed message carries the new distance')
  assert.ok(captured[1].value.message.includes('ETA 5 min'), 'the refreshed message carries the new ETA')
})

test('clears the alarm exactly once when the POI drops off the route ahead', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const hazard = corridorPoi('h1', 'Hazard', 'Rock', 800)

  alarms.evaluate([hazard])
  // The vessel passed the hazard, so the scan no longer flags it.
  alarms.evaluate([])
  alarms.evaluate([])

  assert.equal(captured.length, 2, 'one warn on appearance, one clear on departure')
  assert.equal(captured[0].value.state, 'warn')
  assert.equal(captured[1].value.state, 'normal')
  assert.equal(captured[1].path, 'notifications.navigation.crowsNest.route.h1')
  assert.ok(captured[1].value.message.includes('Rock'), 'the clear message names the POI')
})

test('re-arms a POI after it drops off and reappears on the route', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const hazard = corridorPoi('h1', 'Hazard', 'Rock', 800)

  alarms.evaluate([hazard])
  alarms.evaluate([])
  alarms.evaluate([hazard])

  assert.deepEqual(
    captured.map(entry => entry.value.state),
    ['warn', 'normal', 'warn']
  )
})

test('tracks several corridor POIs independently', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const first = corridorPoi('a', 'Hazard', 'Rock', 500)
  const second = corridorPoi('b', 'Lock', 'Lock', 1200)

  // First pass: only `a` is flagged.
  alarms.evaluate([first])
  // Second pass: `b` is now flagged and `a` has been passed.
  alarms.evaluate([second])

  assert.equal(captured.length, 3)
  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.route.a')
  assert.equal(captured[0].value.state, 'warn')
  const secondPass = captured.slice(1)
  const bWarn = secondPass.find(entry => entry.path.endsWith('.b'))
  const aClear = secondPass.find(entry => entry.path.endsWith('.a'))
  assert.equal(bWarn?.value.state, 'warn')
  assert.equal(aClear?.value.state, 'normal')
})

test('sanitizes a POI id that carries path-breaking characters', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)

  alarms.evaluate([corridorPoi('a.b/c', 'Hazard', 'Rock', 800)])

  assert.equal(captured[0].path, 'notifications.navigation.crowsNest.route.escaped.YS5iL2M')
})

test('clearAll clears every active route alarm exactly once', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)

  alarms.evaluate([
    corridorPoi('h1', 'Hazard', 'Rock one', 500),
    corridorPoi('h2', 'Bridge', 'Bridge two', 900)
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
