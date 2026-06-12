import test from 'node:test'
import assert from 'node:assert/strict'
import type { CourseInfo, NormalizedDelta } from '@signalk/server-api'
import {
  createCourseReader,
  type CourseReaderApp,
  type CourseStream
} from '../src/outputs/route-hazard/course-reader.js'

import { courseWithoutRoute, flush, routeResource } from './helpers.js'

/** A GeoJSON LineString coordinate, `[longitude, latitude]`. */
type Coordinate = [number, number] | [number, number, number]

/** Build a course with an active route referencing the supplied href. */
function courseWithRoute (
  href: string,
  pointIndex: number,
  reverse: boolean,
  name = 'Test route'
): CourseInfo {
  return {
    startTime: null,
    targetArrivalTime: null,
    arrivalCircle: 0,
    activeRoute: { href, pointIndex, pointTotal: 0, reverse, name },
    nextPoint: null,
    previousPoint: null
  } as CourseInfo
}

interface MockOptions {
  course?: CourseInfo | (() => Promise<CourseInfo>)
  resource?: object | (() => Promise<object>)
  selfPaths?: Record<string, unknown>
  selfPathThrows?: boolean
}

interface MockApp {
  app: CourseReaderApp
  resourceCalls: Array<{ resType: string, resId: string }>
  courseCallCount: () => number
  /** Push a delta into every Course API stream the reader subscribed to. */
  emitCourseDelta: (delta?: Partial<NormalizedDelta>) => void
  subscribedPaths: () => string[]
  unsubscribedCount: () => number
}

/** A mock SignalK app with controllable Course, Resources, data model, and streams. */
function createMockApp (options: MockOptions): MockApp {
  const resourceCalls: Array<{ resType: string, resId: string }> = []
  let courseCalls = 0
  const handlers: Array<(delta: NormalizedDelta) => void> = []
  const paths: string[] = []
  let unsubscribed = 0

  const app: CourseReaderApp = {
    getCourse: async () => {
      courseCalls++
      if (typeof options.course === 'function') {
        return await options.course()
      }
      return options.course ?? courseWithoutRoute()
    },
    resourcesApi: {
      getResource: async (resType, resId) => {
        resourceCalls.push({ resType, resId })
        if (typeof options.resource === 'function') {
          return await options.resource()
        }
        if (options.resource === undefined) {
          throw new Error('no routes provider registered')
        }
        return options.resource
      }
    },
    getSelfPath: (path) => {
      if (options.selfPathThrows === true) {
        throw new Error('data model unavailable')
      }
      return options.selfPaths?.[path]
    },
    streambundle: {
      getSelfBus: (path) => {
        paths.push(String(path))
        const stream: CourseStream = {
          onValue: (handler) => {
            handlers.push(handler)
            return () => { unsubscribed++ }
          }
        }
        return stream
      }
    },
    debug: () => {}
  }

  return {
    app,
    resourceCalls,
    courseCallCount: () => courseCalls,
    emitCourseDelta: (delta: Partial<NormalizedDelta> = {}) => {
      for (const handler of handlers) {
        handler(delta as NormalizedDelta)
      }
    },
    subscribedPaths: () => paths,
    unsubscribedCount: () => unsubscribed
  }
}

/** Three waypoints, longitude-first per GeoJSON. */
const THREE_LEG_ROUTE: Coordinate[] = [
  [10, 50],
  [11, 51],
  [12, 52]
]

test('getRouteAhead returns null when no route is active', async () => {
  const { app } = createMockApp({ course: courseWithoutRoute() })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('getRouteAhead returns null before the first resolution completes', () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  // No flush: the construction-time refresh has not resolved yet.
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('getRouteAhead resolves the active route after construction', async () => {
  const { app, resourceCalls } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource(THREE_LEG_ROUTE),
    selfPaths: { 'navigation.position': { latitude: 49, longitude: 9 } }
  })
  const reader = createCourseReader({ app })
  await flush()
  const result = reader.getRouteAhead()

  assert.notEqual(result, null)
  assert.equal(result?.routeId, 'route-1')
  assert.equal(result?.name, 'Test route')
  assert.deepEqual(result?.vesselPosition, { latitude: 49, longitude: 9 })
  assert.deepEqual(result?.waypoints, [
    { latitude: 50, longitude: 10 },
    { latitude: 51, longitude: 11 },
    { latitude: 52, longitude: 12 }
  ])
  assert.deepEqual(resourceCalls, [{ resType: 'routes', resId: 'route-1' }])
  reader.stop()
})

test('getRouteAhead reads a fresh vessel position on every call', async () => {
  const selfPaths: Record<string, unknown> = {
    'navigation.position': { latitude: 49, longitude: 9 }
  }
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource(THREE_LEG_ROUTE),
    selfPaths
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.deepEqual(reader.getRouteAhead()?.vesselPosition, { latitude: 49, longitude: 9 })
  // The vessel moves; the cached route geometry stays, the position updates.
  selfPaths['navigation.position'] = { latitude: 48, longitude: 8 }
  assert.deepEqual(reader.getRouteAhead()?.vesselPosition, { latitude: 48, longitude: 8 })
  reader.stop()
})

test('getRouteAhead slices the route forward from a non-zero pointIndex', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 1, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.deepEqual(reader.getRouteAhead()?.waypoints, [
    { latitude: 51, longitude: 11 },
    { latitude: 52, longitude: 12 }
  ])
  reader.stop()
})

test('getRouteAhead returns a reverse route in travel order', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, true),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  // Reverse traversal: the stored route end becomes the first waypoint ahead.
  assert.deepEqual(reader.getRouteAhead()?.waypoints, [
    { latitude: 52, longitude: 12 },
    { latitude: 51, longitude: 11 },
    { latitude: 50, longitude: 10 }
  ])
  reader.stop()
})

test('getRouteAhead slices a reverse route from a non-zero pointIndex', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 1, true),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.deepEqual(reader.getRouteAhead()?.waypoints, [
    { latitude: 51, longitude: 11 },
    { latitude: 50, longitude: 10 }
  ])
  reader.stop()
})

test('getRouteAhead clamps a pointIndex past the route end to the last waypoint', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 99, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.deepEqual(reader.getRouteAhead()?.waypoints, [{ latitude: 52, longitude: 12 }])
  reader.stop()
})

test('getRouteAhead clamps a negative pointIndex to the first waypoint', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', -5, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.equal(reader.getRouteAhead()?.waypoints.length, 3)
  reader.stop()
})

test('getRouteAhead parses the route id from an href with a trailing slash', async () => {
  const { app, resourceCalls } = createMockApp({
    course: courseWithRoute('/resources/routes/route-9/', 0, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.equal(resourceCalls[0]?.resId, 'route-9')
  reader.stop()
})

test('getRouteAhead drops the altitude from a three-element coordinate', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource([[10, 50, 100], [11, 51, 200]])
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.deepEqual(reader.getRouteAhead()?.waypoints, [
    { latitude: 50, longitude: 10 },
    { latitude: 51, longitude: 11 }
  ])
  reader.stop()
})

test('getRouteAhead skips malformed coordinate entries', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource([
      [10, 50],
      ['bad', 51],
      [11],
      [Number.NaN, 52],
      [12, 53]
    ])
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.deepEqual(reader.getRouteAhead()?.waypoints, [
    { latitude: 50, longitude: 10 },
    { latitude: 53, longitude: 12 }
  ])
  reader.stop()
})

test('getRouteAhead omits the name when the active route has none', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false, ''),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()

  assert.equal(reader.getRouteAhead()?.name, undefined)
  reader.stop()
})

test('getRouteAhead returns a null vesselPosition when there is no fix', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource(THREE_LEG_ROUTE),
    selfPaths: { 'navigation.position': null }
  })
  const reader = createCourseReader({ app })
  await flush()
  const result = reader.getRouteAhead()

  assert.equal(result?.vesselPosition, null)
  assert.equal(result?.waypoints.length, 3)
  reader.stop()
})

test('getRouteAhead stays null when getCourse rejects', async () => {
  const { app } = createMockApp({
    course: async () => { throw new Error('course unavailable') }
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('getRouteAhead stays null when no routes provider is registered', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false)
    // resource omitted: getResource rejects, as it would with no provider.
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('getRouteAhead stays null when the route resource has no coordinates', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: { feature: { type: 'Feature', geometry: { type: 'LineString' } } }
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('getRouteAhead stays null when every coordinate entry is malformed', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource([['bad', 'data'], [42]])
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('getRouteAhead stays null for an unparseable href', async () => {
  const { app } = createMockApp({
    course: courseWithRoute('', 0, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('the reader subscribes to the v1 Course API route paths', () => {
  const { app, subscribedPaths } = createMockApp({ course: courseWithoutRoute() })
  const reader = createCourseReader({ app })

  assert.deepEqual(subscribedPaths(), [
    'navigation.courseGreatCircle.activeRoute.href',
    'navigation.courseGreatCircle.nextPoint.position'
  ])
  reader.stop()
})

test('a course delta refreshes the cached route', async () => {
  let course = courseWithoutRoute()
  const { app, emitCourseDelta } = createMockApp({
    course: async () => course,
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead(), null)

  // A route is now activated; the Course API emits a delta.
  course = courseWithRoute('/resources/routes/route-1', 0, false)
  emitCourseDelta()
  await flush()

  assert.equal(reader.getRouteAhead()?.routeId, 'route-1')
  reader.stop()
})

test('a course delta clearing the route resets the cache to null', async () => {
  let course = courseWithRoute('/resources/routes/route-1', 0, false)
  const { app, emitCourseDelta } = createMockApp({
    course: async () => course,
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead()?.routeId, 'route-1')

  // Navigation is canceled; the Course API emits a delta.
  course = courseWithoutRoute()
  emitCourseDelta()
  await flush()

  assert.equal(reader.getRouteAhead(), null)
  reader.stop()
})

test('a null-valued activeRoute delta clears the cache synchronously', async () => {
  let course = courseWithRoute('/resources/routes/route-1', 0, false)
  const { app, emitCourseDelta } = createMockApp({
    course: async () => course,
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.equal(reader.getRouteAhead()?.routeId, 'route-1')

  // The Course API signals a cleared route with a null delta value. The handler
  // drops the cache synchronously, without (and before) any getCourse round
  // trip: asserting null with no intervening flush proves the fast path ran.
  course = courseWithoutRoute()
  emitCourseDelta({ value: null })
  assert.equal(reader.getRouteAhead(), null, 'cleared synchronously on the null delta')
  reader.stop()
})

test('stop unsubscribes from every Course API stream and drops the cache', async () => {
  const { app, unsubscribedCount } = createMockApp({
    course: courseWithRoute('/resources/routes/route-1', 0, false),
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()
  assert.notEqual(reader.getRouteAhead(), null)

  reader.stop()
  assert.equal(unsubscribedCount(), 2)
  assert.equal(reader.getRouteAhead(), null)
})

test('stop is idempotent', async () => {
  const { app, unsubscribedCount } = createMockApp({ course: courseWithoutRoute() })
  const reader = createCourseReader({ app })
  await flush()

  reader.stop()
  reader.stop()
  assert.equal(unsubscribedCount(), 2)
})

test('a course delta after stop does not refresh the cache', async () => {
  let course = courseWithoutRoute()
  const { app, emitCourseDelta, courseCallCount } = createMockApp({
    course: async () => course,
    resource: routeResource(THREE_LEG_ROUTE)
  })
  const reader = createCourseReader({ app })
  await flush()
  reader.stop()
  const callsAtStop = courseCallCount()

  // A late delta must not drive a refresh, and the cache stays null.
  course = courseWithRoute('/resources/routes/route-1', 0, false)
  emitCourseDelta()
  await flush()

  assert.equal(courseCallCount(), callsAtStop)
  assert.equal(reader.getRouteAhead(), null)
})

test('getVesselState reads position and speed over ground', () => {
  const { app } = createMockApp({
    course: courseWithoutRoute(),
    selfPaths: {
      'navigation.position': { latitude: 49, longitude: 9 },
      'navigation.speedOverGround': 5.4
    }
  })
  const reader = createCourseReader({ app })
  const state = reader.getVesselState()

  assert.deepEqual(state.position, { latitude: 49, longitude: 9 })
  assert.equal(state.speedOverGround, 5.4)
  reader.stop()
})

test('getVesselState returns null fields when the values are missing', () => {
  const { app } = createMockApp({ course: courseWithoutRoute(), selfPaths: {} })
  const reader = createCourseReader({ app })
  const state = reader.getVesselState()

  assert.equal(state.position, null)
  assert.equal(state.speedOverGround, null)
  reader.stop()
})

test('getVesselState returns null fields when getSelfPath throws', () => {
  const { app } = createMockApp({ course: courseWithoutRoute(), selfPathThrows: true })
  const reader = createCourseReader({ app })
  const state = reader.getVesselState()

  assert.equal(state.position, null)
  assert.equal(state.speedOverGround, null)
  reader.stop()
})
