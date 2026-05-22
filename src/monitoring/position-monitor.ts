/**
 * Position monitor.
 *
 * Shared infrastructure for the position-driven outputs. When at least one
 * such output is enabled, this module subscribes to the vessel's
 * `navigation.position` through the SignalK app and throttles those updates: a
 * tick runs only when the vessel has moved a meaningful distance and at most
 * once per minute.
 *
 * Each tick is driven by the registered `PositionScanContributor`s. The
 * monitor asks every contributor for a fetch bounding box, unions the non-null
 * boxes into one list request, and then hands the combined result to every
 * contributor's `evaluate`. A single list request per tick serves every
 * contributor. When no contributor produces a box, `evaluate` is still called
 * with an empty result so an output can clear stale alarms.
 *
 * The monitor owns only the position subscription. Each contributor's owning
 * output tears its own resources down through its `OutputHandle.stop`; the
 * monitor's `stop()` only unsubscribes from the position stream.
 */

import type { NormalizedDelta, Path } from '@signalk/server-api'
import { distanceMeters, toPosition, unionBbox } from '../geo/position-utilities.js'
import type { PositionScanContributor } from '../outputs/output.js'
import type { PluginStatus } from '../status/plugin-status.js'
import type { Bbox, PoiSummary, Position } from '../shared/types.js'

/** The `vessels.self` path the monitor subscribes to. */
const SELF_POSITION_PATH = 'navigation.position'

/** Default minimum distance, in meters, the vessel must move before a tick. */
const DEFAULT_MIN_MOVE_METERS = 100

/** Default minimum time, in milliseconds, between ticks. */
const DEFAULT_MIN_INTERVAL_MS = 60_000

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

/** The slice of the POI source the monitor needs for the per-tick scan. */
export interface PoiListSource {
  listPointsOfInterest: (bbox: Bbox, poiTypes: string) => Promise<PoiSummary[]>
}

/** Dependencies and tunables for {@link createPositionMonitor}. */
export interface PositionMonitorConfig {
  /** The SignalK app, used for the position stream and debug logging. */
  app: MonitorApp
  /** The POI source, used to list nearby points of interest. */
  client: PoiListSource
  /**
   * The status recorder. Each per-tick list request reports its outcome here
   * so the status panel reflects an alarm-only install that never serves the
   * notes resource yet is failing every scan.
   */
  status: PluginStatus
  /** The position-driven outputs that contribute to and consume each tick. */
  contributors: readonly PositionScanContributor[]
  /**
   * The comma-separated `poiTypes` string for the list request. It must
   * include every type any contributor needs, otherwise that contributor
   * never sees the points of interest it acts on.
   */
  poiTypes: string
  /** Minimum distance, in meters, the vessel must move before a new tick. */
  minMoveMeters?: number
  /** Minimum time, in milliseconds, between ticks. */
  minIntervalMs?: number
  /** Clock source, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
}

/** Public surface of the position monitor. */
export interface PositionMonitor {
  /**
   * Tear the monitor down: unsubscribe from the position stream. Idempotent.
   * Each contributor's owning output clears its own alarms and resources in
   * its `OutputHandle.stop`.
   */
  stop: () => void
}

/**
 * Create a position monitor and subscribe it to `navigation.position`.
 *
 * @param config Dependencies and throttle tunables.
 * @returns A handle whose `stop()` unsubscribes the monitor.
 */
export function createPositionMonitor (config: PositionMonitorConfig): PositionMonitor {
  const { app, client, contributors, poiTypes, status } = config
  const minMoveMeters = config.minMoveMeters ?? DEFAULT_MIN_MOVE_METERS
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = config.now ?? Date.now

  let stopped = false
  // True while a scan request is outstanding, so a burst of position updates
  // cannot stack overlapping list requests on top of one another.
  let tickInFlight = false
  // The most recent position fix, updated on every delta even while a scan is
  // in flight. Contributors evaluate against this, not the position the tick
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
      // Ask every contributor for its fetch box, then union the non-null boxes
      // into one list request.
      let bbox: Bbox | undefined
      for (const contributor of contributors) {
        const box = contributor.buildFetchBox(tickPosition)
        if (box !== null) {
          bbox = bbox === undefined ? box : unionBbox(bbox, box)
        }
      }

      // No box means nothing to fetch this tick. Contributors are still
      // evaluated with an empty result so an output can clear stale alarms
      // (for example a route that has just been finished or canceled).
      const vesselPosition = latestPosition ?? tickPosition
      if (bbox === undefined) {
        for (const contributor of contributors) {
          contributor.evaluate(vesselPosition, [])
        }
        return
      }

      const pois = await client.listPointsOfInterest(bbox, poiTypes)
      status.recordListFetch(pois.length)
      // A response that lands after stop() must not drive an evaluation.
      if (stopped) {
        return
      }
      // Evaluate against the newest fix, not the one the scan started from.
      const latest = latestPosition ?? tickPosition
      for (const contributor of contributors) {
        contributor.evaluate(latest, pois)
      }
    } catch (error) {
      // A failed scan is non-fatal and expected while offline: this tick simply
      // has no fresh data. Logged at debug level so an offline passage does not
      // spam the log, and recorded so the status panel reflects the failure
      // even on an alarm-only install that never serves the notes resource.
      const message = `Position monitor scan failed: ${String(error)}`
      app.debug(message)
      status.recordError(message)
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
      app.debug('Position monitor stopped')
    }
  }
}
