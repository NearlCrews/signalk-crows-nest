import test from 'node:test'
import assert from 'node:assert/strict'
import type { CourseInfo, NormalizedDelta } from '@signalk/server-api'
import { routeHazardOutput } from '../src/outputs/route-hazard/route-hazard-output.js'
import type { OutputContext } from '../src/outputs/output.js'
import type { PoiSummary } from '../src/shared/types.js'
import { courseWithoutRoute, flush, routeResource } from './helpers.js'

/** Build a course with an active route referencing the supplied href. */
function courseWithRoute (href: string): CourseInfo {
  return {
    startTime: null,
    targetArrivalTime: null,
    arrivalCircle: 0,
    activeRoute: { href, pointIndex: 0, pointTotal: 0, reverse: false, name: 'Test route' },
    nextPoint: null,
    previousPoint: null
  } as CourseInfo
}

/** A two-waypoint route running due north along longitude 0. */
const NORTHBOUND_ROUTE: Array<[number, number]> = [[0, 0], [0, 1]]

interface MockOptions {
  course?: CourseInfo | (() => Promise<CourseInfo>)
  resource?: object
}

interface MockContext {
  context: OutputContext
  messages: unknown[]
  emitCourseDelta: () => void
  unsubscribedCount: () => number
}

/** Build an OutputContext whose app stub drives the course reader and alarms. */
function createContext (options: MockOptions): MockContext {
  const messages: unknown[] = []
  const handlers: Array<(delta: NormalizedDelta) => void> = []
  let unsubscribed = 0

  const app = {
    getCourse: async (): Promise<CourseInfo> => {
      if (typeof options.course === 'function') {
        return await options.course()
      }
      return options.course ?? courseWithoutRoute()
    },
    resourcesApi: {
      getResource: async (): Promise<object> => {
        if (options.resource === undefined) {
          throw new Error('no routes provider registered')
        }
        return options.resource
      }
    },
    getSelfPath: () => undefined,
    streambundle: {
      getSelfBus: () => ({
        onValue: (handler: (delta: NormalizedDelta) => void) => {
          handlers.push(handler)
          return () => { unsubscribed++ }
        }
      })
    },
    handleMessage: (_id: string, delta: unknown) => { messages.push(delta) },
    debug: () => {}
  }

  const context = {
    app,
    config: { enableRouteHazardScan: true, routeCorridorWidthMeters: 500 },
    pois: {} as never,
    status: {} as never
  } as unknown as OutputContext

  return {
    context,
    messages,
    emitCourseDelta: () => {
      for (const handler of handlers) {
        handler({} as unknown as NormalizedDelta)
      }
    },
    unsubscribedCount: () => unsubscribed
  }
}

test('isEnabled tracks the config flag', () => {
  assert.equal(routeHazardOutput.isEnabled({ enableRouteHazardScan: true } as never), true)
  assert.equal(routeHazardOutput.isEnabled({ enableRouteHazardScan: false } as never), false)
})

test('start contributes a route scan for Hazard, Bridge, and Lock', () => {
  // Asserting set-equality (deepEqual on a sorted copy) catches BOTH a
  // missing required type and an unexpected addition. The previous
  // includes() pattern would silently pass if a future regression added
  // Marina or Anchorage to the scan, ballooning the per-tick list request.
  const { context } = createContext({ course: courseWithoutRoute() })
  const handle = routeHazardOutput.start(context)
  assert.ok(handle.positionScan)
  assert.deepEqual(
    [...handle.positionScan.poiTypes].sort(),
    ['Bridge', 'Hazard', 'Lock']
  )
  handle.stop()
})

test('buildFetchBox returns null when no route is active', async () => {
  const { context } = createContext({ course: courseWithoutRoute() })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)
  assert.equal(handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 }), null)
  handle.stop()
})

test('buildFetchBox returns a corridor box for the active route', async () => {
  const { context } = createContext({
    course: courseWithRoute('/resources/routes/route-1'),
    resource: routeResource(NORTHBOUND_ROUTE)
  })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)
  const box = handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 })
  assert.ok(box !== null && box.north > box.south && box.east > box.west)
  // The first leg is about 60 nautical miles, so the 10 nautical mile cap must
  // clip it near latitude 0.166 rather than querying all the way to latitude 1.
  assert.ok(box !== null && box.north > 0.16, 'the box reaches the clipped endpoint')
  assert.ok(box !== null && box.north < 0.18, 'the box does not include the full long leg')
  assert.ok(box !== null && box.south < 0, 'the box reaches below the near waypoint')
  handle.stop()
})

test('buildFetchBox keeps an antimeridian-crossing route corridor narrow', async () => {
  const seamRoute: Array<[number, number]> = [[179.95, 0], [-179.95, 0]]
  const { context } = createContext({
    course: courseWithRoute('/resources/routes/seam-route'),
    resource: routeResource(seamRoute)
  })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)

  const box = handle.positionScan.buildFetchBox({ latitude: 0, longitude: 179.94 })
  assert.ok(box !== null)
  assert.ok(box.west > box.east, 'the route corridor crosses the antimeridian')
  assert.ok(360 - box.west + box.east < 1, 'the route corridor spans less than one degree')

  handle.stop()
})

test('a tick with a route raises an alarm, a tick without a route clears it', async () => {
  let course = courseWithRoute('/resources/routes/route-1')
  const { context, messages, emitCourseDelta } = createContext({
    course: async () => course,
    resource: routeResource(NORTHBOUND_ROUTE)
  })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)

  // A hazard close ahead on the route corridor raises one notification.
  const hazard: PoiSummary = {
    id: 'h1',
    name: 'Rock',
    type: 'Hazard',
    position: { latitude: 0.1, longitude: 0 },
    source: 'activecaptain',
    url: 'https://activecaptain.garmin.com/en-US/pois/h1',
    attribution: 'Data from Garmin ActiveCaptain',
    skIcon: 'hazard'
  }
  handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 })
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [hazard])
  assert.equal(messages.length, 1)

  // The route is canceled; a tick with no route clears the stale alarm.
  course = courseWithoutRoute()
  emitCourseDelta()
  await flush()
  handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 })
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [])
  assert.equal(messages.length, 2)
  handle.stop()
})

test('evaluate scans the corridor from the fresh fix, not the frozen one', async () => {
  const { context, messages } = createContext({
    course: courseWithRoute('/resources/routes/route-1'),
    resource: routeResource(NORTHBOUND_ROUTE)
  })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)

  // A hazard south of the route's first waypoint at latitude 0. Measured from
  // the route waypoints alone it projects behind the route start and is not
  // flagged; measured from a fresh vessel fix further south, it sits on the
  // vessel-to-first-waypoint leg and must be flagged. evaluate must use the
  // fresh position the monitor passes, not the one buildFetchBox froze.
  const hazard: PoiSummary = {
    id: 'h1',
    name: 'Rock',
    type: 'Hazard',
    position: { latitude: -0.05, longitude: 0 },
    source: 'activecaptain',
    url: 'https://activecaptain.garmin.com/en-US/pois/h1',
    attribution: 'Data from Garmin ActiveCaptain',
    skIcon: 'hazard'
  }
  handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 })
  handle.positionScan.evaluate({ latitude: -0.1, longitude: 0 }, [hazard])
  assert.equal(messages.length, 1, 'the corridor scan measured from the fresh fix')
  handle.stop()
})

test('a POI well outside the corridor is not alarmed', async () => {
  const { context, messages } = createContext({
    course: courseWithRoute('/resources/routes/route-1'),
    resource: routeResource(NORTHBOUND_ROUTE)
  })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)

  // A hazard 0.1 deg of longitude east of the route (about 11 km) is far
  // outside the 500 m corridor half-width, so evaluate must not alarm it.
  const hazard: PoiSummary = {
    id: 'h1',
    name: 'Distant rock',
    type: 'Hazard',
    position: { latitude: 0.5, longitude: 0.1 },
    source: 'activecaptain',
    url: 'https://activecaptain.garmin.com/en-US/pois/h1',
    attribution: 'Data from Garmin ActiveCaptain',
    skIcon: 'hazard'
  }
  handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 })
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [hazard])
  assert.equal(messages.length, 0)
  handle.stop()
})

test('stop stops the course reader and clears active alarms', async () => {
  const { context, messages, unsubscribedCount } = createContext({
    course: courseWithRoute('/resources/routes/route-1'),
    resource: routeResource(NORTHBOUND_ROUTE)
  })
  const handle = routeHazardOutput.start(context)
  await flush()
  assert.ok(handle.positionScan)

  const hazard: PoiSummary = {
    id: 'h1',
    name: 'Rock',
    type: 'Hazard',
    position: { latitude: 0.1, longitude: 0 },
    source: 'activecaptain',
    url: 'https://activecaptain.garmin.com/en-US/pois/h1',
    attribution: 'Data from Garmin ActiveCaptain',
    skIcon: 'hazard'
  }
  handle.positionScan.buildFetchBox({ latitude: 0, longitude: 0 })
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [hazard])
  assert.equal(messages.length, 1)

  handle.stop()
  // stop() clears the active alarm and unsubscribes both Course API streams.
  assert.equal(messages.length, 2)
  assert.equal(unsubscribedCount(), 2)
})
