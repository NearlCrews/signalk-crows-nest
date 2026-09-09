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
 * Fetching and evaluating run on separate cadences, because they cost
 * different things. A list request reaches every enabled upstream, so it stays
 * on the tick throttle. An evaluation is geometry over a list already in
 * memory, so a contributor that declares an alarm radius is re-evaluated
 * against the last result on every position fix: the alarm zone around a point
 * of interest is a window a moving vessel can pass straight through between
 * two list requests, and the tick throttle alone decides how wide that window
 * has to be before it is missed. `scan-cadence.ts` derives the sampling from
 * the tightest declared radius, and the same figures bound how far the vessel
 * may travel before the fetched list stops describing the water around it.
 *
 * The monitor owns only the position subscription. Each contributor's owning
 * output tears its own resources down through its `OutputHandle.stop`; the
 * monitor's `stop()` only unsubscribes from the position stream.
 */

import type { NormalizedDelta, Path } from '@signalk/server-api'
import { distanceMeters, toPosition, unionBbox } from '../geo/position-utilities.js'
import {
  deriveScanCadence,
  MAX_EVALUATION_INTERVAL_MS,
  MIN_EVALUATION_INTERVAL_MS,
  SMALLEST_COVERED_RADIUS_METERS
} from './scan-cadence.js'
import type { PositionScanContributor } from '../outputs/output.js'
import { METERS_PER_NAUTICAL_MILE } from '../shared/length.js'
import { SELF_POSITION_PATH } from '../shared/self-paths.js'
import { MS_PER_MINUTE, SECONDS_PER_HOUR } from '../shared/time.js'
import type { Bbox, PoiSummary, Position } from '../shared/types.js'

/** Default minimum distance, in meters, the vessel must move before a tick. */
const DEFAULT_MIN_MOVE_METERS = 100

/** Default minimum time, in milliseconds, between ticks. */
const DEFAULT_MIN_INTERVAL_MS = MS_PER_MINUTE

/**
 * Shortest gap, in milliseconds, between two reports that the vessel outran
 * the alarm sampling. The condition holds for as long as the vessel keeps that
 * speed up, and the operator needs to read it once, not once a second.
 */
const COVERAGE_REPORT_INTERVAL_MS = MS_PER_MINUTE

/** Render a speed in meters per second as knots, for an operator-facing line. */
function knots (metersPerSecond: number): string {
  return (metersPerSecond * SECONDS_PER_HOUR / METERS_PER_NAUTICAL_MILE).toFixed(1)
}

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
  /**
   * Report a condition the operator has to know about. Used for the one case
   * the monitor cannot fix on its own: the vessel outrunning the sampling the
   * configured alarm radius needs, which leaves a gap no log-level-debug line
   * would surface.
   */
  error: (message: string) => void
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
   * The most recent vessel position the monitor has seen, or undefined when
   * no fix has arrived yet. Read by the US-only POI inputs to skip outbound
   * HTTP when the vessel is outside US waters.
   */
  getCurrentPosition: () => Position | undefined
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
  const { app, client, contributors, poiTypes } = config
  const minMoveMeters = config.minMoveMeters ?? DEFAULT_MIN_MOVE_METERS
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = config.now ?? Date.now

  let stopped = false
  // True while a scan request is outstanding, so a burst of position updates
  // cannot stack overlapping list requests on top of one another.
  let tickInFlight = false
  // A contributor invalidation that arrives during a scan is collapsed into
  // one follow-up tick. Unlike a position update, it bypasses the movement and
  // interval gates because route activation and cancellation must take effect
  // while the vessel is stationary.
  let forcedTickPending = false
  // The most recent position fix, updated on every delta even while a scan is
  // in flight. Contributors evaluate against this, not the position the tick
  // started from, so a multi-second request does not check stale coordinates.
  let latestPosition: Position | undefined
  let lastTickPosition: Position | undefined
  let lastTickTime = 0
  // The most recent list result, replayed by the between-request evaluations,
  // and the time the request behind it landed. Undefined until the first list
  // request has produced one, so an alarm check never runs against a list the
  // monitor does not have yet, and the fetch time is only ever read behind that
  // guard. One place writes both, so the two cannot drift apart.
  let lastPois: PoiSummary[] | undefined
  let lastPoisFetchedAt = 0
  let lastEvaluationPosition: Position | undefined
  let lastEvaluationTime = 0
  let lastCoverageReportTime = 0

  // The contributors whose alarms fire only inside a circle around a point of
  // interest. They are the ones re-evaluated between list requests, and the
  // ones the sampling cadence is sized for.
  const zoneContributors = contributors.filter(
    (contributor) => contributor.alarmRadiusMeters !== undefined
  )
  // The POI types those contributors read, which is all the replayed copy has
  // to carry. The combined result holds every enabled output's types, so in
  // busy water most of it belongs to outputs that never see a replay: keeping
  // it would re-walk thousands of points on every fix and hold them in memory
  // between ticks with no reader. A contributor sees exactly the points of its
  // declared types either way, which is the contract `poiTypes` states.
  const replayPoiTypes = new Set<string>()
  for (const contributor of zoneContributors) {
    for (const poiType of contributor.poiTypes) {
      replayPoiTypes.add(poiType)
    }
  }
  const cadence = deriveScanCadence(contributors)

  /**
   * Decide whether a position warrants a tick: always on the first fix, then
   * only when both the time and the distance thresholds have been met, or once
   * the vessel has left the water the last list described.
   */
  function shouldTick (position: Position): boolean {
    if (lastTickPosition === undefined) {
      return true
    }
    const moved = distanceMeters(lastTickPosition, position)
    // Past this the fetched box no longer reaches around the tightest alarm
    // zone, so the vessel is steaming into water the last list never covered.
    // No refetch interval is worth honoring at that point.
    if (moved >= cadence.coverageMoveMeters) {
      return true
    }
    if (now() - lastTickTime < minIntervalMs) {
      return false
    }
    return moved >= minMoveMeters
  }

  /**
   * Report a jump between two evaluations wide enough to straddle the tightest
   * alarm zone, which is what a vessel outrunning the sampling looks like from
   * here. Rate-limited, because the condition holds for as long as the speed
   * does and repeating it every fix would bury it.
   */
  function reportCoverageGap (vesselPosition: Position): void {
    if (lastEvaluationPosition === undefined || cadence.tightestRadiusMeters === undefined) {
      return
    }
    // Negated on purpose: a non-finite gap (a bad coordinate) falls out here
    // rather than reporting a nonsense distance.
    const gap = distanceMeters(lastEvaluationPosition, vesselPosition)
    if (!(gap > cadence.coveredChordMeters)) {
      return
    }
    const at = now()
    if (at - lastCoverageReportTime < COVERAGE_REPORT_INTERVAL_MS) {
      return
    }
    lastCoverageReportTime = at
    app.error(
      `Position monitor: the vessel covered ${Math.round(gap)} m between alarm checks, ` +
      `more than the ${Math.round(cadence.coveredChordMeters)} m a ${Math.round(cadence.tightestRadiusMeters)} m ` +
      'alarm radius can be sampled across. A point of interest may pass through the alarm radius ' +
      'without raising an alarm. Widen the alarm radius, or check that the vessel position is ' +
      'publishing at least once a second.'
    )
  }

  /**
   * Run the given contributors' evaluate against the newest fix. Each call
   * runs in its own try/catch so a throwing contributor never short-circuits
   * its siblings.
   */
  function evaluateContributors (
    vesselPosition: Position,
    pois: PoiSummary[],
    listFetchedAt: number,
    targets: readonly PositionScanContributor[]
  ): void {
    reportCoverageGap(vesselPosition)
    lastEvaluationPosition = vesselPosition
    lastEvaluationTime = now()
    for (const contributor of targets) {
      try {
        contributor.evaluate(vesselPosition, pois, listFetchedAt)
      } catch (error) {
        app.debug(`Position monitor: contributor evaluate failed: ${String(error)}`)
      }
    }
  }

  /**
   * Run every contributor's evaluate: the tick path, which all of them share.
   * The result also becomes the list the between-request evaluations replay,
   * narrowed to the types those evaluations read, the empty result of a tick
   * that fetched nothing included. Each zone contributor therefore sees the
   * same points on a replay as it saw on the tick, so a replay can never
   * disagree with the tick that produced it.
   */
  function evaluateAll (vesselPosition: Position, pois: PoiSummary[]): void {
    // Keep the time this request landed, once, before anything replays the
    // result. The alarm outputs run their reconfirmation window on it, so a
    // replay does not read as a fresh report and an outage that stops every
    // request still expires a held alarm.
    const listFetchedAt = now()
    lastPois = pois.filter((poi) => replayPoiTypes.has(poi.type))
    lastPoisFetchedAt = listFetchedAt
    evaluateContributors(vesselPosition, pois, listFetchedAt, contributors)
  }

  /**
   * Decide whether a fix warrants re-running the zone contributors' checks
   * against the list already in hand: once the vessel has covered the sampling
   * distance, or once the idle ceiling has elapsed so a stopped vessel still
   * gets the transitions that do not come from motion.
   */
  function shouldEvaluate (position: Position): boolean {
    if (lastEvaluationPosition === undefined) {
      return true
    }
    const elapsed = now() - lastEvaluationTime
    if (elapsed < MIN_EVALUATION_INTERVAL_MS) {
      return false
    }
    if (elapsed >= MAX_EVALUATION_INTERVAL_MS) {
      return true
    }
    return distanceMeters(lastEvaluationPosition, position) >= cadence.evaluationMoveMeters
  }

  /** Re-run the zone contributors' checks against the last list result. */
  function maybeEvaluate (): void {
    if (stopped || zoneContributors.length === 0) {
      return
    }
    if (latestPosition === undefined || lastPois === undefined) {
      return
    }
    if (!shouldEvaluate(latestPosition)) {
      return
    }
    evaluateContributors(latestPosition, lastPois, lastPoisFetchedAt, zoneContributors)
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
      // into one list request. A throwing contributor only loses its own box
      // this tick: its siblings still contribute and still evaluate, so a
      // crash in the route-hazard fetch box never silently disables the
      // proximity alarm.
      let bbox: Bbox | undefined
      for (const contributor of contributors) {
        let box: Bbox | null = null
        try {
          box = contributor.buildFetchBox(tickPosition)
        } catch (error) {
          app.debug(`Position monitor: contributor buildFetchBox failed: ${String(error)}`)
        }
        if (box !== null) {
          bbox = bbox === undefined ? box : unionBbox(bbox, box)
        }
      }

      // No box means nothing to fetch this tick. Contributors are still
      // evaluated with an empty result so an output can clear stale alarms
      // (for example a route that has just been finished or canceled).
      if (bbox === undefined) {
        evaluateAll(latestPosition ?? tickPosition, [])
        return
      }

      const pois = await client.listPointsOfInterest(bbox, poiTypes)
      // A response that lands after stop() must not drive an evaluation.
      if (stopped) {
        return
      }
      // Evaluate against the newest fix, not the one the scan started from:
      // on a moving vessel the two differ by the distance traveled during the
      // multi-second list request.
      evaluateAll(latestPosition ?? tickPosition, pois)
    } catch (error) {
      // A failed scan is non-fatal and expected while offline: this tick simply
      // has no fresh data. Logged at debug level so an offline passage does not
      // spam the log. The aggregate POI source records each failed source's
      // error onto the per-source status itself, so the monitor does not.
      const message = `Position monitor scan failed: ${String(error)}`
      app.debug(message)
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
    if (!forcedTickPending && !shouldTick(latestPosition)) {
      return
    }
    forcedTickPending = false
    const tickPosition = latestPosition
    app.debug(`Position monitor tick at ${tickPosition.latitude}, ${tickPosition.longitude}`)
    // runTick handles its own errors internally and never rejects; the catch
    // is a defensive guard so an unexpected throw cannot become an unhandled
    // rejection from this fire-and-forget call.
    runTick(tickPosition).catch((error: unknown) => {
      app.debug(`Position monitor tick failed unexpectedly: ${String(error)}`)
    })
  }

  /** Request a scan for a contributor change that is independent of motion. */
  function requestScan (): void {
    if (stopped) {
      return
    }
    forcedTickPending = true
    maybeTick()
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
    // Independent of the tick: a list request is throttled to protect the
    // upstreams, while the alarm checks against the list already in hand cost
    // nothing that needs protecting.
    maybeEvaluate()
  }

  const unsubscribe = app.streambundle
    .getSelfBus(SELF_POSITION_PATH as Path)
    .onValue(onPosition)
  for (const contributor of contributors) {
    contributor.setScanRequester?.(requestScan)
  }
  app.debug('Position monitor started; subscribed to navigation.position')
  if (cadence.tightestRadiusMeters !== undefined) {
    const summary =
      `Position monitor alarm sampling: every ${Math.round(cadence.evaluationMoveMeters)} m ` +
      `for a ${Math.round(cadence.tightestRadiusMeters)} m alarm radius`
    if (cadence.maxCoveredSpeedMps > 0) {
      app.debug(`${summary}; covered up to ${knots(cadence.maxCoveredSpeedMps)} kn`)
    } else {
      // Nothing the monitor can do about this one: the alarm zone is narrower
      // than the shortest distance the sampling can resolve, so an alarm this
      // tight fires only by luck. Say so at start rather than leaving the
      // operator to infer it from alarms that never come.
      app.error(
        `${summary}. A radius this tight is narrower than the sampling can resolve, so a point of ` +
        'interest can pass through it without raising an alarm. Widen the proximity alarm radius ' +
        `to at least ${Math.ceil(SMALLEST_COVERED_RADIUS_METERS)} m.`
      )
    }
  }

  return {
    getCurrentPosition: () => latestPosition,
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      forcedTickPending = false
      for (const contributor of contributors) {
        contributor.setScanRequester?.(() => {})
      }
      unsubscribe()
      app.debug('Position monitor stopped')
    }
  }
}
