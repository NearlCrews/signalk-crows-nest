import test from 'node:test'
import assert from 'node:assert/strict'
import type { NormalizedDelta } from '@signalk/server-api'
import {
  createPositionMonitor,
  type MonitorApp,
  type PoiListSource,
  type PositionStream
} from '../src/monitoring/position-monitor.js'
import type { ProximityAlarms } from '../src/outputs/proximity-alarm/proximity-alarms.js'
import type { CourseReader } from '../src/outputs/route-hazard/course-reader.js'
import { createRouteHazardAlarms, type RouteAlarmApp } from '../src/outputs/route-hazard/route-hazard-alarms.js'
import type { Bbox, PoiSummary, Position, RoutePolyline } from '../src/shared/types.js'

/** Resolve once the pending microtasks (an awaited hazard scan) have drained. */
const flush = (): Promise<void> =>
  new Promise<void>(resolve => { setImmediate(resolve) })

/** A controllable monotonic clock, so the throttle is tested without waiting. */
function createClock (): { now: () => number, advance: (ms: number) => void } {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms: number) => { current += ms }
  }
}

/** A mock SignalK app exposing a single position stream the test drives. */
function createMockApp (): {
  app: MonitorApp
  emit: (value: unknown) => void
  isUnsubscribed: () => boolean
  subscribedPath: () => string | undefined
} {
  let handler: ((delta: NormalizedDelta) => void) | undefined
  let unsubscribed = false
  let path: string | undefined
  const stream: PositionStream = {
    onValue: (incoming) => {
      handler = incoming
      return () => { unsubscribed = true }
    }
  }
  const app: MonitorApp = {
    streambundle: {
      getSelfBus: (requestedPath) => {
        path = String(requestedPath)
        return stream
      }
    },
    debug: () => {}
  }
  return {
    app,
    // A position delta carries only `value` for the monitor's purposes.
    emit: (value) => { handler?.({ value } as unknown as NormalizedDelta) },
    isUnsubscribed: () => unsubscribed,
    subscribedPath: () => path
  }
}

type ClientMode = 'resolve' | 'reject' | 'pending'

/** A mock ActiveCaptain client recording hazard-scan calls. */
function createMockClient (): {
  client: PoiListSource
  calls: Array<{ bbox: Bbox, poiTypes: string }>
  setPois: (pois: PoiSummary[]) => void
  setMode: (mode: ClientMode) => void
} {
  const calls: Array<{ bbox: Bbox, poiTypes: string }> = []
  let pois: PoiSummary[] = []
  let mode: ClientMode = 'resolve'
  const client: PoiListSource = {
    listPointsOfInterest: async (bbox, poiTypes) => {
      calls.push({ bbox, poiTypes })
      if (mode === 'pending') {
        return new Promise<PoiSummary[]>(() => {})
      }
      if (mode === 'reject') {
        throw new Error('network down')
      }
      return pois
    }
  }
  return {
    client,
    calls,
    setPois: (next) => { pois = next },
    setMode: (next) => { mode = next }
  }
}

/** A mock proximity alarms instance recording evaluate and clearAll calls. */
function createMockAlarms (): {
  alarms: ProximityAlarms
  evaluations: Array<{ position: Position, pois: PoiSummary[] }>
  clearAllCount: () => number
} {
  const evaluations: Array<{ position: Position, pois: PoiSummary[] }> = []
  let clearAll = 0
  const alarms: ProximityAlarms = {
    evaluate: (position, pois) => { evaluations.push({ position, pois }) },
    clearAll: () => { clearAll += 1 }
  }
  return { alarms, evaluations, clearAllCount: () => clearAll }
}

const HAZARD: PoiSummary = {
  id: 'h1',
  type: 'Hazard',
  position: { latitude: 10.01, longitude: 20 },
  name: 'Rock'
}

test('subscribes to navigation.position and ticks on the first fix', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    now: createClock().now
  })

  assert.equal(mockApp.subscribedPath(), 'navigation.position')

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the first fix triggers a hazard scan')
  assert.equal(mockClient.calls[0].poiTypes, 'Hazard', 'the poiTypes string is passed through')
  assert.equal(mockAlarms.evaluations.length, 1, 'the alarms are evaluated')
  assert.deepEqual(mockAlarms.evaluations[0].position, { latitude: 10, longitude: 20 })
  assert.deepEqual(mockAlarms.evaluations[0].pois, [HAZARD])

  monitor.stop()
})

test('evaluates the alarms against the newest fix, not the one the scan started from', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    now: createClock().now
  })

  // The first fix starts a scan; a newer fix arrives before the scan's
  // request resolves, so the in-flight scan must evaluate the newer one.
  mockApp.emit({ latitude: 10, longitude: 20 })
  mockApp.emit({ latitude: 10.01, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the in-flight scan is not duplicated')
  assert.equal(mockAlarms.evaluations.length, 1)
  assert.deepEqual(
    mockAlarms.evaluations[0].position,
    { latitude: 10.01, longitude: 20 },
    'the evaluation uses the newest position, not the scan start position'
  )

  monitor.stop()
})

test('does not tick again before the minimum interval elapses', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  const clock = createClock()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  // Move far enough to clear the distance gate, but not far enough in time.
  clock.advance(30_000)
  mockApp.emit({ latitude: 11, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the interval gate suppresses the second tick')

  monitor.stop()
})

test('does not tick again until the vessel moves the minimum distance', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  const clock = createClock()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    minMoveMeters: 100,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  // Past the interval, but a move of about 55 m, short of the 100 m gate.
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.0005, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'the distance gate suppresses the second tick')

  // A move of several kilometers clears both gates.
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 2, 'a tick runs once both gates are met')

  monitor.stop()
})

test('ignores malformed position values', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    now: createClock().now
  })

  mockApp.emit(null)
  mockApp.emit({ latitude: 10 })
  mockApp.emit({ latitude: 'ten', longitude: 20 })
  mockApp.emit({ latitude: Number.NaN, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 0, 'no tick runs for an unusable position')

  // A valid fix after the malformed ones still ticks.
  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  monitor.stop()
})

test('stop() unsubscribes, clears alarms, and prevents further ticks', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  const clock = createClock()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  monitor.stop()
  assert.equal(mockApp.isUnsubscribed(), true, 'the position stream is unsubscribed')
  assert.equal(mockAlarms.clearAllCount(), 1, 'outstanding alarms are cleared')

  // A position update after stop must not trigger another tick.
  clock.advance(120_000)
  mockApp.emit({ latitude: 11, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'no tick runs after stop')

  // stop() is idempotent.
  monitor.stop()
  assert.equal(mockAlarms.clearAllCount(), 1, 'a second stop does not clear again')
})

test('a failed hazard scan does not throw and does not evaluate the alarms', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  const clock = createClock()
  mockClient.setMode('reject')

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)
  assert.equal(mockAlarms.evaluations.length, 0, 'a rejected hazard scan skips evaluation')

  // The monitor recovers: a later successful tick still evaluates.
  mockClient.setMode('resolve')
  mockClient.setPois([HAZARD])
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 2)
  assert.equal(mockAlarms.evaluations.length, 1, 'the monitor recovers after a failure')

  monitor.stop()
})

test('does not start an overlapping tick while a hazard scan is in flight', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  const clock = createClock()
  mockClient.setMode('pending')

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'the first tick starts a hazard scan')

  // The first scan never resolves; a later eligible fix must not stack a
  // second request on top of it.
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'no overlapping hazard scan is started')

  monitor.stop()
})

test('a hazard scan that resolves after stop does not evaluate the alarms', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const mockAlarms = createMockAlarms()
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard',
    scanRadiusMeters: 1000,
    now: createClock().now
  })

  // Stop before the hazard scan's promise settles.
  mockApp.emit({ latitude: 10, longitude: 20 })
  monitor.stop()
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the hazard-scan request was issued')
  assert.equal(mockAlarms.evaluations.length, 0, 'a late response does not evaluate after stop')
})

// --- Route-corridor hazard scan integration -------------------------------
// These exercise the monitor wired to the real route-corridor scan and the
// real route hazard alarms, with only the Course API reader stubbed.

/** A captured route notification. */
interface CapturedRouteNotification {
  path: string
  state: string
  message: string
}

/** A RouteAlarmApp that records every route notification delta it is handed. */
function createRouteAlarmRecorder (): {
  app: RouteAlarmApp
  captured: CapturedRouteNotification[]
} {
  const captured: CapturedRouteNotification[] = []
  const app: RouteAlarmApp = {
    handleMessage: (_id, delta) => {
      const update = delta.updates?.[0]
      if (update !== undefined && 'values' in update) {
        for (const pathValue of update.values) {
          const value = pathValue.value as { state: string, message: string }
          captured.push({
            path: String(pathValue.path),
            state: value.state,
            message: value.message
          })
        }
      }
    },
    debug: () => {}
  }
  return { app, captured }
}

/** A stub CourseReader returning a fixed route and speed over ground. */
function createMockCourseReader (
  route: RoutePolyline | null,
  speedOverGround: number | null
): { reader: CourseReader, routeCalls: () => number, stopCalls: () => number } {
  let routeCalls = 0
  let stopCalls = 0
  const reader: CourseReader = {
    getRouteAhead: () => {
      routeCalls += 1
      return route
    },
    getVesselState: () => ({
      position: route?.vesselPosition ?? null,
      speedOverGround
    }),
    stop: () => { stopCalls += 1 }
  }
  return { reader, routeCalls: () => routeCalls, stopCalls: () => stopCalls }
}

/** A route running due north from the origin, with two waypoints. */
const ROUTE: RoutePolyline = {
  routeId: 'r1',
  name: 'Test route',
  vesselPosition: { latitude: 0, longitude: 0 },
  waypoints: [
    { latitude: 0.05, longitude: 0 },
    { latitude: 0.1, longitude: 0 }
  ]
}

/** A Hazard sitting on the route line, roughly 2.2 km along the first leg. */
const ON_ROUTE_HAZARD: PoiSummary = {
  id: 'r-haz',
  type: 'Hazard',
  position: { latitude: 0.02, longitude: 0 },
  name: 'Mid-channel rock'
}

test('runs the route-corridor scan and raises a route notification for a POI on the route', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  mockClient.setPois([ON_ROUTE_HAZARD])
  const course = createMockCourseReader(ROUTE, 5)
  const recorder = createRouteAlarmRecorder()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    poiTypes: 'Hazard,Bridge,Lock',
    scanRadiusMeters: 1000,
    routeScan: {
      courseReader: course.reader,
      alarms: createRouteHazardAlarms(recorder.app),
      corridorWidthMeters: 500
    },
    now: createClock().now
  })

  mockApp.emit({ latitude: 0, longitude: 0 })
  await flush()

  assert.equal(course.routeCalls(), 1, 'the active route is read for the tick')
  assert.equal(mockClient.calls.length, 1, 'a single list request serves the tick')
  assert.equal(recorder.captured.length, 1, 'the on-route hazard raises one notification')
  assert.equal(recorder.captured[0].path, 'notifications.navigation.activecaptain.route.r-haz')
  assert.equal(recorder.captured[0].state, 'warn')
  assert.ok(recorder.captured[0].message.includes('Mid-channel rock'), 'message names the hazard')

  monitor.stop()
})

test('widens the fetch bounding box to enclose the route ahead', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  mockClient.setPois([ON_ROUTE_HAZARD])
  const course = createMockCourseReader(ROUTE, 5)
  const recorder = createRouteAlarmRecorder()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    poiTypes: 'Hazard,Bridge,Lock',
    scanRadiusMeters: 1000,
    routeScan: {
      courseReader: course.reader,
      alarms: createRouteHazardAlarms(recorder.app),
      corridorWidthMeters: 500
    },
    now: createClock().now
  })

  mockApp.emit({ latitude: 0, longitude: 0 })
  await flush()

  // The 1000 m vessel scan box around the origin is tiny; the route runs
  // north to latitude 0.1, so the widened box must reach the far waypoint.
  assert.equal(mockClient.calls.length, 1)
  assert.ok(
    mockClient.calls[0].bbox.north >= 0.1,
    'the fetch box is widened to enclose the route ahead'
  )

  monitor.stop()
})

test('skips the list request when no route is active and proximity alarms are off', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const course = createMockCourseReader(null, 5)
  const recorder = createRouteAlarmRecorder()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    poiTypes: 'Hazard,Bridge,Lock',
    scanRadiusMeters: 1000,
    routeScan: {
      courseReader: course.reader,
      alarms: createRouteHazardAlarms(recorder.app),
      corridorWidthMeters: 500
    },
    now: createClock().now
  })

  mockApp.emit({ latitude: 0, longitude: 0 })
  await flush()

  assert.equal(course.routeCalls(), 1, 'the route is still read')
  assert.equal(mockClient.calls.length, 0, 'no list request is spent when there is nothing to scan')
  assert.equal(recorder.captured.length, 0, 'no route notification is raised')

  monitor.stop()
})

test('evaluates both the proximity alarms and the route scan on one tick', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  mockClient.setPois([ON_ROUTE_HAZARD])
  const mockAlarms = createMockAlarms()
  const course = createMockCourseReader(ROUTE, 5)
  const recorder = createRouteAlarmRecorder()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    alarms: mockAlarms.alarms,
    poiTypes: 'Hazard,Bridge,Lock',
    scanRadiusMeters: 1000,
    routeScan: {
      courseReader: course.reader,
      alarms: createRouteHazardAlarms(recorder.app),
      corridorWidthMeters: 500
    },
    now: createClock().now
  })

  mockApp.emit({ latitude: 0, longitude: 0 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'one list request serves both checks')
  assert.equal(mockAlarms.evaluations.length, 1, 'the proximity alarms are evaluated')
  assert.equal(recorder.captured.length, 1, 'the route scan is evaluated')

  monitor.stop()
})

test('stop() clears outstanding route alarms', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  mockClient.setPois([ON_ROUTE_HAZARD])
  const course = createMockCourseReader(ROUTE, 5)
  const recorder = createRouteAlarmRecorder()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    poiTypes: 'Hazard,Bridge,Lock',
    scanRadiusMeters: 1000,
    routeScan: {
      courseReader: course.reader,
      alarms: createRouteHazardAlarms(recorder.app),
      corridorWidthMeters: 500
    },
    now: createClock().now
  })

  mockApp.emit({ latitude: 0, longitude: 0 })
  await flush()
  assert.equal(recorder.captured.length, 1, 'a route alarm is raised')

  monitor.stop()
  const clears = recorder.captured.slice(1)
  assert.equal(clears.length, 1, 'the outstanding route alarm is cleared on stop')
  assert.equal(clears[0].state, 'normal')
  assert.equal(course.stopCalls(), 1, 'the Course API reader is stopped')
})

test('clears outstanding route alarms when the active route is deactivated mid-passage', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  mockClient.setPois([ON_ROUTE_HAZARD])
  const recorder = createRouteAlarmRecorder()
  const clock = createClock()

  // A course reader whose active route is cleared partway through the passage,
  // as happens when the crew reaches the destination or cancels navigation.
  let activeRoute: RoutePolyline | null = ROUTE
  const reader: CourseReader = {
    getRouteAhead: () => activeRoute,
    getVesselState: () => ({ position: activeRoute?.vesselPosition ?? null, speedOverGround: 5 }),
    stop: () => {}
  }

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    poiTypes: 'Hazard,Bridge,Lock',
    scanRadiusMeters: 1000,
    routeScan: {
      courseReader: reader,
      alarms: createRouteHazardAlarms(recorder.app),
      corridorWidthMeters: 500
    },
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 0, longitude: 0 })
  await flush()
  assert.equal(recorder.captured.length, 1, 'the on-route hazard raises a warn')
  assert.equal(recorder.captured[0].state, 'warn')

  // The route is deactivated; a later tick must still clear the stale alarm.
  activeRoute = null
  clock.advance(120_000)
  mockApp.emit({ latitude: 0.05, longitude: 0 })
  await flush()

  assert.equal(recorder.captured.length, 2, 'the stale route alarm is cleared once the route is gone')
  assert.equal(recorder.captured[1].state, 'normal')
  assert.equal(recorder.captured[1].path, 'notifications.navigation.activecaptain.route.r-haz')

  monitor.stop()
})
