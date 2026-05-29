import test from 'node:test'
import assert from 'node:assert/strict'
import { proximityAlarmOutput } from '../src/outputs/proximity-alarm/proximity-alarm-output.js'
import type { OutputContext } from '../src/outputs/output.js'
import { northOfOrigin } from './helpers.js'

/** Build an OutputContext whose app records every notification delta. */
function createContext (messages: unknown[]): OutputContext {
  return {
    app: { handleMessage: (_id: string, d: unknown) => messages.push(d), debug: () => {} },
    config: { enableProximityAlarms: true, proximityAlarmRadiusMeters: 500 },
    pois: {} as never,
    status: {} as never
  } as unknown as OutputContext
}

/**
 * Pull the `{ path, state }` pairs out of the recorded notification deltas, so
 * a test can assert which hazard raised or cleared without re-parsing deltas.
 */
function notifications (messages: unknown[]): Array<{ path: string, state: string }> {
  const out: Array<{ path: string, state: string }> = []
  for (const message of messages) {
    const update = (message as {
      updates?: Array<{ values?: Array<{ path: string, value: { state: string } }> }>
    }).updates?.[0]
    for (const entry of update?.values ?? []) {
      out.push({ path: String(entry.path), state: entry.value.state })
    }
  }
  return out
}

test('isEnabled tracks the config flag', () => {
  assert.equal(proximityAlarmOutput.isEnabled({ enableProximityAlarms: true } as never), true)
  assert.equal(proximityAlarmOutput.isEnabled({ enableProximityAlarms: false } as never), false)
})

test('start contributes a Hazard scan and raises an alarm on evaluate', () => {
  const messages: unknown[] = []
  const context = {
    app: { handleMessage: (_id: string, d: unknown) => messages.push(d), debug: () => {} },
    config: { enableProximityAlarms: true, proximityAlarmRadiusMeters: 500 },
    pois: {} as never,
    status: {} as never
  } as unknown as OutputContext
  const handle = proximityAlarmOutput.start(context)
  assert.ok(handle.positionScan)
  assert.ok(handle.positionScan.poiTypes.includes('Hazard'))
  const box = handle.positionScan.buildFetchBox({ latitude: 10, longitude: 20 })
  assert.ok(box !== null && box.north > 10 && box.south < 10)
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [
    {
      id: 'h1',
      name: 'Rock',
      type: 'Hazard',
      position: { latitude: 0, longitude: 0 },
      source: 'activecaptain',
      url: 'https://activecaptain.garmin.com/en-US/pois/h1',
      attribution: 'Data from Garmin ActiveCaptain',
      skIcon: 'hazard'
    }
  ])
  assert.equal(messages.length, 1)
  handle.stop()
  assert.equal(messages.length, 2) // a clear notification on stop
})

test('a non-Hazard POI inside the radius is ignored', () => {
  const messages: unknown[] = []
  const handle = proximityAlarmOutput.start(createContext(messages))
  assert.ok(handle.positionScan)
  // A marina sitting right on the vessel is well inside the radius, but only
  // Hazard points raise a proximity alarm, so nothing is emitted.
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [
    {
      id: 'm1',
      name: 'Close marina',
      type: 'Marina',
      position: { latitude: 0, longitude: 0 },
      source: 'activecaptain',
      url: 'https://activecaptain.garmin.com/en-US/pois/m1',
      attribution: 'Data from Garmin ActiveCaptain',
      skIcon: 'marina'
    }
  ])
  assert.equal(messages.length, 0)
  handle.stop()
  assert.equal(messages.length, 0, 'stop has no active alarm to clear')
})

test('multiple hazards raise and clear independently', () => {
  const messages: unknown[] = []
  const handle = proximityAlarmOutput.start(createContext(messages))
  assert.ok(handle.positionScan)

  const tag = {
    source: 'activecaptain',
    url: 'https://activecaptain.garmin.com/en-US/pois/x',
    attribution: 'Data from Garmin ActiveCaptain',
    skIcon: 'hazard'
  }
  const near = { id: 'near', name: 'Near rock', type: 'Hazard' as const, position: northOfOrigin(100), ...tag }
  const far = { id: 'far', name: 'Far rock', type: 'Hazard' as const, position: northOfOrigin(3000), ...tag }

  // Pass one: only `near` is within the 500 m radius.
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [near, far])
  // Pass two: the vessel moved to `far`, so `far` raises and `near` clears.
  handle.positionScan.evaluate(northOfOrigin(3000), [near, far])

  const events = notifications(messages)
  assert.equal(events.length, 3)
  assert.deepEqual(events[0], {
    path: 'notifications.navigation.crowsNest.hazard.near', state: 'alarm'
  })
  const farRaise = events.slice(1).find(entry => entry.path.endsWith('.far'))
  const nearClear = events.slice(1).find(entry => entry.path.endsWith('.near'))
  assert.equal(farRaise?.state, 'alarm')
  assert.equal(nearClear?.state, 'normal')
  handle.stop()
})
