/**
 * Course API reader.
 *
 * This module tracks the vessel's active route from the SignalK v2 Course API
 * and exposes it, on demand and synchronously, as a forward-looking polyline
 * that a route-corridor hazard scan can consume. It also exposes a synchronous
 * read of the vessel's own position and speed over ground.
 *
 * The accessors are synchronous so the position-monitor tick can read the
 * route without an `await` and without adding any per-tick API traffic. To
 * make that possible the reader maintains the route itself: it subscribes to
 * the Course API deltas and, whenever the course changes, resolves the route
 * in the background and caches the result. `getRouteAhead()` is then a plain
 * read of that cache.
 *
 * Resolving the route takes two asynchronous steps. The Course API
 * (`app.getCourse()`) reports the active route as an `href` plus a `pointIndex`
 * and a `reverse` flag; the v1 course deltas carry only the `href`, so the full
 * descriptor still comes from `getCourse()`. The route resource, with its
 * waypoint coordinates, lives under `/resources/routes` and is fetched through
 * the Resources API. The reader joins the two: it parses the route id from the
 * href, fetches the route resource, orders the coordinates in travel direction,
 * and keeps the waypoints from the next waypoint to the route end.
 *
 * The Course API emits the route on the v1 `navigation.courseGreatCircle.*`
 * paths (the `navigation.course.*` paths are v2 only and do not reach the v1
 * stream), so the reader subscribes there.
 *
 * No path here throws: a missing route, an unregistered Resources provider, or
 * a malformed resource all leave the cache `null`, logged at debug level,
 * because a vessel with no active route is the common case and not an error.
 * The reader holds a subscription, so `stop()` tears it down.
 */

import type { CourseInfo, NormalizedDelta, Path } from '@signalk/server-api'
import { toPosition } from '../../geo/position-utilities.js'
import { isValidLatitude, isValidLongitude, toFiniteNumber } from '../../shared/numbers.js'
import { SELF_POSITION_PATH, SELF_SOG_PATH } from '../../shared/self-paths.js'
import type { Position, RoutePolyline, VesselState } from '../../shared/types.js'

/**
 * The v1 course path carrying the active route href. A delta here means a
 * route has been set or cleared.
 */
const COURSE_ACTIVE_ROUTE_PATH = 'navigation.courseGreatCircle.activeRoute.href'

/**
 * The v1 course path carrying the next-point position. A delta here means the
 * destination has advanced along the route, or the route has been set or
 * cleared.
 */
const COURSE_NEXT_POINT_PATH = 'navigation.courseGreatCircle.nextPoint.position'

/** The SignalK resource type that holds route waypoint geometry. */
const ROUTE_RESOURCE_TYPE = 'routes'

/**
 * The minimal Bacon-stream surface the reader consumes: subscribe to values
 * and receive an unsubscribe function. `StreamBundle.getSelfBus` returns a
 * `Bacon.Bus`, which satisfies this structurally.
 */
export interface CourseStream {
  onValue: (handler: (delta: NormalizedDelta) => void) => () => void
}

/**
 * The slice of the SignalK app the reader needs. The real `ServerAPI` satisfies
 * this structurally, so the plugin entrypoint passes `app` directly; tests pass
 * a small stub.
 */
export interface CourseReaderApp {
  /** Course API: the current course, including the active route descriptor. */
  getCourse: () => Promise<CourseInfo>
  /** Resources API: used to fetch the route resource referenced by the course. */
  resourcesApi: {
    getResource: (resType: string, resId: string) => Promise<object>
  }
  /** Reads a `vessels.self` value from the full data model. */
  getSelfPath: (path: string) => unknown
  /** Stream access, used to watch the Course API deltas. */
  streambundle: {
    getSelfBus: (path: Path) => CourseStream
  }
  /** Debug logger, gated by the server's debug toggle. */
  debug: (message: string) => void
}

/** Dependencies for {@link createCourseReader}. */
export interface CourseReaderConfig {
  /** The SignalK app, used for the Course API, Resources API, and data model. */
  app: CourseReaderApp
  /** Called after the cached route changes, including when it is cleared. */
  onRouteChange?: () => void
}

/** Public surface of the course reader. */
export interface CourseReader {
  /**
   * The vessel's active route as a forward-looking polyline, read synchronously
   * from the reader's cache. `null` when no route is active, when no Resources
   * provider is registered, when the route data is malformed, or before the
   * first background resolution has completed. The `vesselPosition` field is
   * the caller's position when one is passed (the monitor's tick position),
   * otherwise a live read taken at call time; the waypoints come from the
   * cache.
   */
  getRouteAhead: (vesselPosition?: Position | null) => RoutePolyline | null
  /**
   * The current vessel position and speed over ground, read synchronously from
   * the data model. Either field is `null` when its value is missing or
   * unusable.
   */
  getVesselState: () => VesselState
  /**
   * Tear the reader down: unsubscribe from the Course API deltas and drop the
   * cached route. Idempotent.
   */
  stop: () => void
}

/**
 * Narrow a GeoJSON coordinate entry (`[longitude, latitude, altitude?]`) into a
 * `Position`, or return `null` when it is not a usable pair. GeoJSON orders a
 * coordinate longitude first; the altitude, when present, is dropped.
 */
function toGeoJsonPosition (entry: unknown): Position | null {
  if (!Array.isArray(entry) || entry.length < 2) {
    return null
  }
  const [longitude, latitude] = entry as unknown[]
  const lon = toFiniteNumber(longitude)
  const lat = toFiniteNumber(latitude)
  if (lon === null || lat === null || !isValidLongitude(lon) || !isValidLatitude(lat)) {
    return null
  }
  return { latitude: lat, longitude: lon }
}

/**
 * Parse the route resource id from a course `href` such as
 * `/resources/routes/<id>`. Returns the final non-empty path segment, or
 * `null` when the href is missing or empty.
 */
function parseRouteId (href: unknown): string | null {
  if (typeof href !== 'string') {
    return null
  }
  const segments = href.split('/').filter((segment) => segment.length > 0)
  const last = segments.at(-1)
  return last !== undefined && last.length > 0 ? last : null
}

/**
 * Extract the ordered waypoint positions from a fetched route resource. The
 * route geometry lives at `feature.geometry.coordinates` as a GeoJSON
 * LineString. Coordinate entries that are not usable number pairs are skipped.
 * Returns `null` when no usable coordinate is found.
 */
function extractCoordinates (resource: object): Position[] | null {
  const coordinates = (
    resource as { feature?: { geometry?: { coordinates?: unknown } } }
  ).feature?.geometry?.coordinates
  if (!Array.isArray(coordinates)) {
    return null
  }
  const positions: Position[] = []
  for (const entry of coordinates) {
    const position = toGeoJsonPosition(entry)
    if (position !== null) {
      positions.push(position)
    }
  }
  return positions.length > 0 ? positions : null
}

/**
 * Clamp a course `pointIndex` into a valid index for an array of `length`
 * waypoints. A non-finite or negative index falls back to the first waypoint;
 * an index past the end falls back to the last. `length` must be at least 1.
 */
function clampIndex (index: unknown, length: number): number {
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) {
    return 0
  }
  if (index > length - 1) {
    return length - 1
  }
  return Math.floor(index)
}

/**
 * Create a course reader and subscribe it to the Course API deltas.
 *
 * @param config Dependencies for the reader.
 * @returns A handle exposing synchronous reads of the active route and the
 *   vessel state. `stop()` tears the reader down.
 */
export function createCourseReader (config: CourseReaderConfig): CourseReader {
  const { app, onRouteChange = () => {} } = config

  let stopped = false
  // The most recently resolved route ahead, or null when no route is active.
  // Its `vesselPosition` is a placeholder: `getRouteAhead` overrides it with a
  // live read so the corridor scan always measures from the current position.
  let currentRoute: RoutePolyline | null = null
  // Incremented at the start of every refresh. A refresh only commits its
  // result when its generation is still the latest, so a slow resolution that
  // lands after a newer one started cannot overwrite the newer state.
  let refreshGeneration = 0

  /** Read the vessel position from the data model, or `null` when there is no fix. */
  function readPosition (): Position | null {
    let raw: unknown
    try {
      raw = app.getSelfPath(SELF_POSITION_PATH)
    } catch (error) {
      app.debug(`Course reader could not read ${SELF_POSITION_PATH}: ${String(error)}`)
      return null
    }
    return toPosition(raw)
  }

  /** Read speed over ground, in m/s, from the data model, or `null` when unavailable. */
  function readSpeedOverGround (): number | null {
    let raw: unknown
    try {
      raw = app.getSelfPath(SELF_SOG_PATH)
    } catch (error) {
      app.debug(`Course reader could not read ${SELF_SOG_PATH}: ${String(error)}`)
      return null
    }
    return toFiniteNumber(raw)
  }

  function getVesselState (): VesselState {
    return {
      position: readPosition(),
      speedOverGround: readSpeedOverGround()
    }
  }

  /**
   * Build a route polyline from a resolved active-route descriptor and its
   * fetched route resource, or `null` when the resource has no usable geometry.
   * The `vesselPosition` is left null here: `getRouteAhead` fills it live.
   */
  function buildRoutePolyline (
    routeId: string,
    activeRoute: NonNullable<CourseInfo['activeRoute']>,
    resource: object
  ): RoutePolyline | null {
    const coordinates = extractCoordinates(resource)
    if (coordinates === null) {
      app.debug(`Course reader found no usable coordinates in route ${routeId}`)
      return null
    }

    // Order the coordinates in travel direction. A route followed in reverse
    // is stored start-to-end but traversed end-to-start, so the array is
    // reversed first; `pointIndex` then indexes into this travel-order array.
    //
    // `pointIndex` is a travel-order index: this is verified against the
    // SignalK server's Course API, whose `getRoutePoint` resolves a reverse
    // route's point as `coordinates[length - (index + 1)]`, i.e. index 0 is
    // the last stored coordinate, which is the first point in travel order.
    // Reversing the array and then slicing by `pointIndex` matches that.
    const travelOrder = activeRoute.reverse === true
      ? [...coordinates].reverse()
      : coordinates
    const pointIndex = clampIndex(activeRoute.pointIndex, travelOrder.length)

    // The waypoints ahead of the vessel run from the next waypoint (the
    // current destination, at pointIndex) to the route end.
    const waypoints = travelOrder.slice(pointIndex)
    if (waypoints.length === 0) {
      app.debug(`Course reader found no waypoints ahead in route ${routeId}`)
      return null
    }

    const name = typeof activeRoute.name === 'string' && activeRoute.name.length > 0
      ? activeRoute.name
      : undefined

    return {
      routeId,
      ...(name !== undefined && { name }),
      vesselPosition: null,
      waypoints
    }
  }

  /**
   * Commit a refresh result, unless the reader has stopped or a newer refresh
   * has already superseded this one.
   */
  function applyRefresh (generation: number, route: RoutePolyline | null): void {
    if (stopped || generation !== refreshGeneration) {
      return
    }
    currentRoute = route
    onRouteChange()
  }

  /**
   * Re-resolve the active route into the cache. Reads the course, fetches the
   * route resource, and stores the resulting polyline. Every failure resolves
   * the cache to `null`; this never rejects.
   */
  async function refresh (): Promise<void> {
    const generation = ++refreshGeneration

    let course: CourseInfo
    try {
      course = await app.getCourse()
    } catch (error) {
      app.debug(`Course reader could not read the course: ${String(error)}`)
      applyRefresh(generation, null)
      return
    }

    const activeRoute = course?.activeRoute
    if (activeRoute === null || activeRoute === undefined) {
      // No route is being followed. This is the common case, not an error.
      applyRefresh(generation, null)
      return
    }

    const routeId = parseRouteId(activeRoute.href)
    if (routeId === null) {
      app.debug(`Course reader could not parse a route id from href ${String(activeRoute.href)}`)
      applyRefresh(generation, null)
      return
    }

    let resource: object
    try {
      resource = await app.resourcesApi.getResource(ROUTE_RESOURCE_TYPE, routeId)
    } catch (error) {
      // A failed fetch is expected when no routes provider is registered, or
      // when the route was deleted after the course was set. Non-fatal.
      app.debug(`Course reader could not fetch route ${routeId}: ${String(error)}`)
      applyRefresh(generation, null)
      return
    }

    applyRefresh(generation, buildRoutePolyline(routeId, activeRoute, resource))
  }

  /**
   * Kick off a background refresh. `refresh` handles its own errors and never
   * rejects; the catch is a defensive guard so an unexpected throw cannot
   * become an unhandled rejection from this fire-and-forget call.
   */
  function scheduleRefresh (): void {
    if (stopped) {
      return
    }
    refresh().catch((error: unknown) => {
      app.debug(`Course reader refresh failed unexpectedly: ${String(error)}`)
    })
  }

  function getRouteAhead (vesselPosition?: Position | null): RoutePolyline | null {
    if (currentRoute === null) {
      return null
    }
    // The cached polyline is route geometry only. Pair it with the caller's
    // position when one is supplied (the monitor's fresh tickPosition), or a
    // live data-model read otherwise, so the corridor scan measures the
    // current leg from where the vessel is now, not from where it was when
    // the route was last resolved. The waypoints array is copied so a
    // consumer cannot mutate the cached route.
    return {
      ...currentRoute,
      vesselPosition: vesselPosition !== undefined ? vesselPosition : readPosition(),
      waypoints: [...currentRoute.waypoints]
    }
  }

  /**
   * Delta handler for the `activeRoute.href` path. The bus delivers a
   * `NormalizedDelta`, so the cleared-route signal is a delta whose `value` is
   * null: there is no route to resolve, and the cheapest correct response is to
   * drop the cached polyline synchronously without paying for an
   * `app.getCourse()` round-trip. Any other value falls through to the normal
   * background refresh.
   */
  function onActiveRouteDelta (delta: NormalizedDelta): void {
    if (stopped) {
      return
    }
    if (delta.value === null) {
      // Bump the generation so a refresh that resolves later cannot
      // overwrite the clear, then drop the cached polyline immediately.
      refreshGeneration += 1
      currentRoute = null
      onRouteChange()
      return
    }
    scheduleRefresh()
  }

  // Subscriptions are pushed one at a time: if the second `onValue` throws, the
  // catch unwinds the first so a half-built reader does not leak a live
  // subscription with no handle to release it.
  const unsubscribes: Array<() => void> = []
  try {
    unsubscribes.push(
      app.streambundle.getSelfBus(COURSE_ACTIVE_ROUTE_PATH as Path).onValue(onActiveRouteDelta)
    )
    unsubscribes.push(
      app.streambundle.getSelfBus(COURSE_NEXT_POINT_PATH as Path).onValue(scheduleRefresh)
    )
  } catch (error) {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
    throw error
  }
  // Resolve any route that is already active when the reader is created.
  scheduleRefresh()
  app.debug('Course reader started; subscribed to the Course API route deltas')

  return {
    getRouteAhead,
    getVesselState,
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
      currentRoute = null
      app.debug('Course reader stopped')
    }
  }
}
