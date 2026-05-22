/**
 * Position monitor and hazard scan.
 *
 * When proximity alarms or the route-corridor scan are enabled, this module
 * subscribes to the vessel's `navigation.position` through the SignalK app. It
 * throttles those updates: a tick runs only when the vessel has moved a
 * meaningful distance and at most once per minute. Each tick lists the points
 * of interest in a bounding box, then feeds the result to the proximity
 * alarms, the route-corridor scan, or both, depending on which are enabled.
 * The scan does not populate the point-of-interest detail cache; it only feeds
 * the alarm checks.
 *
 * A single list request per tick serves both features. When the route scan is
 * on and a route is active, the request's bounding box is widened to enclose
 * the route ahead (up to a look-ahead cap), so no second request is needed.
 *
 * The monitor is created in `start()` when either feature is on, and `stop()`
 * fully tears it down: it unsubscribes from the position stream, clears every
 * outstanding alarm, and stops the Course API reader.
 */

import type { NormalizedDelta, Path } from '@signalk/server-api'
import type { CourseReader } from '../outputs/route-hazard/course-reader.js'
import { distanceMeters, positionToBbox, unionBbox } from '../geo/position-utilities.js'
import type { ProximityAlarms } from '../outputs/proximity-alarm/proximity-alarms.js'
import { scanRouteCorridor } from '../outputs/route-hazard/route-corridor.js'
import type { RouteHazardAlarms } from '../outputs/route-hazard/route-hazard-alarms.js'
import type { Bbox, CorridorPoi, PoiSummary, Position, RoutePolyline } from '../shared/types.js'

/** The `vessels.self` path the monitor subscribes to. */
const SELF_POSITION_PATH = 'navigation.position'

/** Default minimum distance, in meters, the vessel must move before a tick. */
const DEFAULT_MIN_MOVE_METERS = 100

/** Default minimum time, in milliseconds, between ticks. */
const DEFAULT_MIN_INTERVAL_MS = 60_000

/** Meters in a nautical mile. */
const METERS_PER_NAUTICAL_MILE = 1852

/**
 * How far ahead along the route, in meters, the fetch bounding box is widened
 * to look. The ActiveCaptain bounding-box endpoint clusters points of interest
 * once the box is too large at its fixed zoom, and the client drops cluster
 * entries, so the look-ahead is capped at a conservative 10 nautical miles.
 * The tick runs as the vessel moves, so a point of interest beyond the cap is
 * picked up on a later tick: a sliding window, not a single long-range scan.
 */
const ROUTE_LOOK_AHEAD_METERS = 10 * METERS_PER_NAUTICAL_MILE

/**
 * The minimal Bacon-stream surface the monitor consumes: subscribe to values
 * and receive an unsubscribe function. `StreamBundle.getSelfBus` returns a
 * `Bacon.Bus`, which satisfies this structurally.
 */
export interface PositionStream {
  onValue: (handler: (delta: NormalizedDelta) => void) => () => void
}

/**
 * The slice of the SignalK app the monitor needs. The real `ServerAPI`
 * satisfies this structurally, so the plugin entrypoint passes `app` directly;
 * tests pass a small stub.
 */
export interface MonitorApp {
  streambundle: {
    getSelfBus: (path: Path) => PositionStream
  }
  debug: (message: string) => void
}

/** The slice of the ActiveCaptain client the monitor needs for the hazard scan. */
export interface PoiListSource {
  listPointsOfInterest: (bbox: Bbox, poiTypes: string) => Promise<PoiSummary[]>
}

/**
 * The route-corridor scan dependencies and tunables. Present on the monitor
 * config only when the route-corridor hazard scan is enabled.
 */
export interface RouteScanConfig {
  /** Reads the vessel's active route and state from the Course API. */
  courseReader: CourseReader
  /** The route-corridor hazard alarms evaluated on every tick with a route. */
  alarms: RouteHazardAlarms
  /** Half-width, in meters, of the corridor a point of interest must fall within. */
  corridorWidthMeters: number
}

/** Dependencies and tunables for {@link createPositionMonitor}. */
export interface PositionMonitorConfig {
  /** The SignalK app, used for the position stream and debug logging. */
  app: MonitorApp
  /** The ActiveCaptain client, used to list nearby points of interest. */
  client: PoiListSource
  /**
   * The proximity alarms evaluated on every tick. Omitted when proximity
   * alarms are disabled and only the route-corridor scan is running.
   */
  alarms?: ProximityAlarms
  /**
   * The route-corridor scan dependencies. Omitted when the route-corridor scan
   * is disabled and only the proximity alarms are running.
   */
  routeScan?: RouteScanConfig
  /**
   * The comma-separated ActiveCaptain `poiTypes` string for the list request.
   * It must include `Hazard` for the proximity alarms, and `Bridge` and `Lock`
   * as well for the route-corridor scan, otherwise those features never see
   * the points of interest they act on.
   */
  poiTypes: string
  /** Radius, in meters, of the bounding box scanned around the vessel. */
  scanRadiusMeters: number
  /**
   * Minimum distance, in meters, the vessel must move before a new tick runs.
   * Defaults to {@link DEFAULT_MIN_MOVE_METERS}.
   */
  minMoveMeters?: number
  /**
   * Minimum time, in milliseconds, between ticks. Defaults to
   * {@link DEFAULT_MIN_INTERVAL_MS}.
   */
  minIntervalMs?: number
  /** Clock source, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
}

/** Public surface of the position monitor. */
export interface PositionMonitor {
  /**
   * Tear the monitor down: unsubscribe from the position stream, clear every
   * outstanding proximity and route-corridor alarm, and stop the Course API
   * reader. Idempotent.
   */
  stop: () => void
}

/**
 * Narrow an unknown delta value into a `Position`, or return null when it is
 * not a usable latitude/longitude pair. A position delta can briefly carry a
 * null value (no fix), so this guards rather than trusting the shape.
 */
function toPosition (value: unknown): Position | null {
  if (value === null || typeof value !== 'object') {
    return null
  }
  const { latitude, longitude } = value as Record<string, unknown>
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }
  return { latitude, longitude }
}

/**
 * Build a bounding box that encloses the route ahead, out to the look-ahead
 * cap, with each point of the route expanded by the corridor half-width so a
 * point of interest offset from the route line is still inside the box.
 *
 * The route is walked leg by leg from the vessel position (when there is a
 * fix) through the waypoints, accumulating leg length; the walk stops at the
 * first point past {@link ROUTE_LOOK_AHEAD_METERS}. Returns null when the
 * route carries no usable points.
 */
function routeCorridorBbox (route: RoutePolyline, corridorWidthMeters: number): Bbox | null {
  const points: Position[] = route.vesselPosition !== null
    ? [route.vesselPosition, ...route.waypoints]
    : [...route.waypoints]

  let box: Bbox | undefined
  let traveledMeters = 0
  let previous: Position | undefined
  for (const point of points) {
    if (previous !== undefined) {
      traveledMeters += distanceMeters(previous, point)
    }
    const pointBox = positionToBbox(point, corridorWidthMeters)
    box = box === undefined ? pointBox : unionBbox(box, pointBox)
    previous = point
    // Include the leg that crosses the cap, then stop: a slightly generous box
    // is harmless, a short one would miss a point of interest near the cap.
    if (traveledMeters >= ROUTE_LOOK_AHEAD_METERS) {
      break
    }
  }
  return box ?? null
}

/**
 * Create a position monitor and subscribe it to `navigation.position`.
 *
 * @param config Dependencies and throttle tunables.
 * @returns A handle whose `stop()` fully tears the monitor down.
 */
export function createPositionMonitor (config: PositionMonitorConfig): PositionMonitor {
  const { app, client, alarms, routeScan, poiTypes, scanRadiusMeters } = config
  const minMoveMeters = config.minMoveMeters ?? DEFAULT_MIN_MOVE_METERS
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = config.now ?? Date.now

  let stopped = false
  // True while a scan request is outstanding, so a burst of position updates
  // cannot stack overlapping list requests on top of one another.
  let tickInFlight = false
  // The most recent position fix, updated on every delta even while a scan is
  // in flight. The scan evaluates hazards against this, not the position it
  // started from, so a multi-second request does not check stale coordinates.
  let latestPosition: Position | undefined
  let lastTickPosition: Position | undefined
  let lastTickTime = 0

  /**
   * Decide whether a position warrants a tick: always on the first fix, then
   * only when both the time and the distance thresholds have been met.
   */
  function shouldTick (position: Position): boolean {
    if (lastTickPosition === undefined) {
      return true
    }
    if (now() - lastTickTime < minIntervalMs) {
      return false
    }
    return distanceMeters(lastTickPosition, position) >= minMoveMeters
  }

  async function runTick (tickPosition: Position): Promise<void> {
    tickInFlight = true
    // Commit the throttle before the await: a tick that started consumes the
    // window whether it succeeds or fails, so a flaky connection cannot drive
    // a tight retry loop.
    lastTickPosition = tickPosition
    lastTickTime = now()
    try {
      // Read the active route when the route scan is on, so the list request's
      // bounding box can be widened to enclose the route ahead. getRouteAhead
      // is a synchronous cache read and never throws: it returns null when
      // there is no active route, which is the common case.
      const route = routeScan !== undefined
        ? routeScan.courseReader.getRouteAhead()
        : null

      // Build the fetch box. The vessel-surroundings box is needed only for the
      // proximity alarms; the route-corridor box only when a route is active.
      // A box is built from just the part that a live feature will read, so a
      // route-only scan does not enlarge the request with vessel surroundings
      // no check consumes.
      let bbox: Bbox | undefined
      if (alarms !== undefined) {
        bbox = positionToBbox(tickPosition, scanRadiusMeters)
      }
      if (routeScan !== undefined && route !== null) {
        const routeBox = routeCorridorBbox(route, routeScan.corridorWidthMeters)
        if (routeBox !== null) {
          bbox = bbox === undefined ? routeBox : unionBbox(bbox, routeBox)
        }
      }

      // No box means nothing to fetch: the proximity alarms are off and there
      // is no active route (or the route produced no usable box). A route that
      // has just been finished or canceled must still have its alarms cleared,
      // so evaluate an empty result before returning.
      if (bbox === undefined) {
        routeScan?.alarms.evaluate([])
        return
      }

      const pois = await client.listPointsOfInterest(bbox, poiTypes)
      // A response that lands after stop() must not drive an evaluation.
      if (stopped) {
        return
      }

      // Evaluate against the newest fix, not the one the scan started from:
      // the rate-limited request can take seconds. The scanned bounding box is
      // far larger than that drift, so the newer position is still inside it.
      if (alarms !== undefined) {
        alarms.evaluate(latestPosition ?? tickPosition, pois)
      }

      // The route-corridor scan runs whenever the route scan is enabled. With a
      // route active it flags the points of interest on the route ahead; with
      // no route active it evaluates an empty result, which clears any route
      // alarms still raised from a route that has just been finished or
      // canceled. Flagged points beyond the look-ahead cap are dropped so the
      // scan stays consistent with the capped fetch box.
      if (routeScan !== undefined) {
        let corridorPois: CorridorPoi[] = []
        if (route !== null) {
          const vesselState = routeScan.courseReader.getVesselState()
          corridorPois = scanRouteCorridor({
            route,
            pois,
            corridorWidthMeters: routeScan.corridorWidthMeters,
            speedOverGround: vesselState.speedOverGround
          }).filter((poi) => poi.alongTrackDistanceMeters <= ROUTE_LOOK_AHEAD_METERS)
        }
        routeScan.alarms.evaluate(corridorPois)
      }
    } catch (error) {
      // A failed scan is non-fatal and expected while offline: the pull-through
      // path still works, this tick simply has no fresh data. Logged at debug
      // level so an offline passage does not spam the log.
      app.debug(`Position monitor scan failed: ${String(error)}`)
    } finally {
      tickInFlight = false
      // A position that arrived while the scan was in flight was deferred;
      // act on it now that the slot is free.
      maybeTick()
    }
  }

  /** Start a tick for the latest position when the throttle and state allow. */
  function maybeTick (): void {
    if (stopped || tickInFlight || latestPosition === undefined) {
      return
    }
    if (!shouldTick(latestPosition)) {
      return
    }
    const tickPosition = latestPosition
    app.debug(`Position monitor tick at ${tickPosition.latitude}, ${tickPosition.longitude}`)
    // runTick handles its own errors internally and never rejects; the catch
    // is a defensive guard so an unexpected throw cannot become an unhandled
    // rejection from this fire-and-forget call.
    runTick(tickPosition).catch((error: unknown) => {
      app.debug(`Position monitor tick failed unexpectedly: ${String(error)}`)
    })
  }

  function onPosition (delta: NormalizedDelta): void {
    if (stopped) {
      return
    }
    const position = toPosition(delta.value)
    if (position === null) {
      return
    }
    latestPosition = position
    maybeTick()
  }

  const unsubscribe = app.streambundle
    .getSelfBus(SELF_POSITION_PATH as Path)
    .onValue(onPosition)
  app.debug('Position monitor started; subscribed to navigation.position')

  return {
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      unsubscribe()
      alarms?.clearAll()
      routeScan?.alarms.clearAll()
      // The route scan injects a Course API reader that holds its own delta
      // subscription, so tearing the monitor down must tear the reader down
      // too, mirroring how the injected alarms are cleared above.
      routeScan?.courseReader.stop()
      app.debug('Position monitor stopped')
    }
  }
}
