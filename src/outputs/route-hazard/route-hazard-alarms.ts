/**
 * Route-corridor hazard alarms.
 *
 * Given the points of interest that the route-corridor scan flagged as lying
 * on the route ahead, this module raises a SignalK notification for each one
 * and clears it once the point of interest is no longer on the route ahead.
 * It mirrors `proximity-alarms.ts`: a notification is raised once when a point
 * of interest first appears on the route and cleared once when it drops off,
 * so an alarm does not re-fire on every tick.
 *
 * The geometry (which points of interest are in the corridor, their along-track
 * distance, and ETA) is the job of `route-corridor.ts`. This module is the
 * stateful raise/clear layer on top of that pure scan.
 *
 * `completeList` sits in front of that scan: it hands back a {@link RouteListScan}
 * whose list is the tick's own with every alarming point the list omitted added
 * back at the position a list last reported it at. An aggregate list result is
 * legitimately partial, and a point missing from a partial result has not left
 * the route ahead, so scanning the raw list would drop it out of the corridor
 * and clear its alarm. See `alarm-retention.ts`. The same record is handed to
 * `evaluate`, which is what keeps the two halves of a tick from drifting apart.
 *
 * The notification is emitted through `app.handleMessage` on the path
 * `notifications.navigation.crowsNest.route.<poiId>`, in the
 * `vessels.self` context. It carries `state: 'warn'` rather than `'alarm'`:
 * a hazard, bridge, or lock several miles ahead on the route is an advisory
 * the crew should plan around, not the imminent danger that the proximity
 * alarm signals. The SignalK severity order is nominal, normal, alert, warn,
 * alarm, then emergency, so `'warn'` correctly ranks below the proximity
 * alarm's `'alarm'`.
 */

import { emitNotification, type NotificationValue } from '../../shared/notification-path.js'
import { createNotificationTracker, type NotificationTrackerApp } from '../../shared/notification-tracker.js'
import { formatClearanceMeters } from '../../shared/bridge-clearance.js'
import { completeWithRetained, unconfirmedClearReason, type RetainedPoi } from '../alarm-retention.js'
import { METERS_PER_KM } from '../../shared/length.js'
import { toFiniteNumber } from '../../shared/numbers.js'
import { MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '../../shared/time.js'
import type { CorridorPoi, PoiSummary } from '../../shared/types.js'

/** Path prefix for the per-point route notification, completed with the POI id. */
const NOTIFICATION_PATH_PREFIX = 'notifications.navigation.crowsNest.route.'

/**
 * `$source` suffix appended to the plugin id, so consumers filtering by
 * source can tell route-corridor alarms from the proximity output even
 * though both come from this plugin.
 */
const SOURCE_SUFFIX = 'route'

/**
 * The clearance verdict for a corridor bridge the bridge air-draft check found
 * too low for the vessel. The route-hazard output builds a map of these, keyed
 * by POI id, between the corridor scan and the alarms: a bridge present in the
 * map gets its warn message upgraded with the clearance figures, while every
 * other corridor point keeps today's generic message.
 */
export interface BridgeClearanceVerdict {
  /** The bridge's charted or tagged vertical clearance, in meters. */
  clearanceMeters: number
  /** The vessel air draft the clearance was compared against, in meters. */
  airDraftMeters: number
  /** The safety margin added to the air draft for the comparison, in meters. */
  marginMeters: number
}

/**
 * Shared empty verdict map: the default when the bridge air-draft check is off,
 * so every existing caller and test passing a single argument keeps working and
 * no per-tick allocation is made on the common path.
 */
const NO_CLEARANCE_VERDICTS: ReadonlyMap<string, BridgeClearanceVerdict> = new Map()

/**
 * Format an along-track distance for the notification message: whole meters
 * under a kilometer, kilometers to one decimal place beyond that.
 */
function formatDistance (meters: number): string {
  if (meters >= METERS_PER_KM) {
    return `${(meters / METERS_PER_KM).toFixed(1)} km`
  }
  return `${Math.round(meters)} m`
}

/**
 * Format an ETA for the notification message: whole minutes under an hour,
 * `<h> h <m> min` beyond that.
 */
function formatEta (seconds: number): string {
  if (seconds >= 0 && seconds < SECONDS_PER_MINUTE) {
    return '<1 min'
  }
  const totalMinutes = Math.round(seconds / SECONDS_PER_MINUTE)
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes} min`
  }
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  return `${hours} h ${minutes} min`
}

/**
 * The slice of the SignalK app the alarms need. The real `ServerAPI` satisfies
 * this structurally, so the plugin entrypoint passes `app` directly; tests
 * pass a small stub.
 */
export type RouteAlarmApp = NotificationTrackerApp

/** What the tracker holds for an alarming corridor point. */
interface RouteEntry extends RetainedPoi {
  /**
   * The point's display name, for the clear message. It comes off the corridor
   * point, so it is known even for a point raised before any list result was
   * recorded for it.
   */
  name: string
  /**
   * The message last emitted for this point, so the notification is refreshed
   * only when the distance, the ETA, or the clearance verdict actually change.
   */
  message: string
}

/**
 * One tick's list, as {@link RouteHazardAlarms.completeList} left it, and the
 * bookkeeping the {@link RouteHazardAlarms.evaluate} that follows needs from
 * it: the summaries the list carried, and when the request behind it landed.
 *
 * A value rather than state on the alarms, so the two halves of a tick are
 * tied together by the call itself: `evaluate` takes the tick's record as an
 * argument rather than reading back whatever the last `completeList` left
 * behind, which is what a caller that skipped it would silently do.
 */
export interface RouteListScan {
  /**
   * The list to run the corridor scan over: the tick's own, completed with
   * every still-warned point it omitted. The caller's own array when nothing
   * had to be added.
   */
  pois: PoiSummary[]
  /**
   * {@link pois} keyed by id: the one index over the tick's list, built here so
   * the route-hazard output does not build a second one to resolve a corridor
   * bridge's clearance. A point newly on the route is held by the summary from
   * here, which is the same object the corridor scan projected it from.
   */
  summaries: ReadonlyMap<string, PoiSummary>
  /**
   * When the request behind the tick's list landed, so a point newly on the
   * route starts its reconfirmation window at the report rather than at the
   * evaluation.
   */
  listFetchedAt: number
}

/** Public surface of the route-corridor hazard alarms. */
export interface RouteHazardAlarms {
  /**
   * Complete a tick's combined list with the last reported summary of every
   * point still alarming that the list omitted, so a partial upstream result
   * cannot drop a point out of the corridor scan and clear its alarm.
   *
   * `listFetchedAt` is when the request behind `pois` landed, which the
   * reconfirmation window runs on. Call this on the tick's list, run the
   * corridor scan over the returned `pois`, then hand the same record back to
   * {@link evaluate} with the corridor points.
   */
  completeList: (pois: PoiSummary[], listFetchedAt: number) => RouteListScan
  /**
   * Evaluate the points of interest the route-corridor scan flagged for the
   * current tick, raising a notification for each one that has just appeared
   * on the route ahead and clearing each one that has just dropped off.
   *
   * `scan` is the record {@link completeList} returned for this tick, which is
   * where a point newly on the route picks up the summary and the report time
   * it will be held by.
   *
   * `tooLow` maps the id of each corridor bridge the air-draft check found too
   * low to its clearance verdict; such a bridge gets a clearance-specific warn
   * message. It defaults to empty, so a caller with the bridge air-draft check
   * off (or no check at all) calls `evaluate(scan, corridorPois)` and every
   * point keeps today's generic message.
   */
  evaluate: (
    scan: RouteListScan,
    corridorPois: CorridorPoi[],
    tooLow?: ReadonlyMap<string, BridgeClearanceVerdict>
  ) => void
  /**
   * Clear every notification currently in the alarm state. Called on plugin
   * stop so a stale route alarm does not linger after the monitor is gone.
   */
  clearAll: () => void
}

/**
 * Create a route-corridor hazard alarm evaluator.
 *
 * @param app The SignalK app, used to emit notification deltas.
 */
export function createRouteHazardAlarms (app: RouteAlarmApp): RouteHazardAlarms {
  // The tracker owns the active set, the clear half, and the episode clock.
  // Each entry keeps the display name (for the clear message), the last
  // message emitted (so the notification can be refreshed when the distance
  // or ETA changes without raising a fresh alarm), and the summary a list last
  // reported the point with (so `completeList` can put it back); the
  // tracker-stamped `raisedAt` keeps `createdAt` at the episode start across
  // refreshes and the clear rather than resetting on every update.
  const tracker = createNotificationTracker<RouteEntry>({
    app,
    pathPrefix: NOTIFICATION_PATH_PREFIX,
    sourceSuffix: SOURCE_SUFFIX,
    buildClearValue: ({ name, unconfirmed }, raisedAt) => ({
      state: 'normal',
      method: [],
      message: unconfirmed === true
        // The point has not dropped off the route, so the clear must not read
        // as though it had.
        ? `"${name}" warning cleared: ${unconfirmedClearReason('on the route ahead')}`
        : `"${name}" is no longer on the route ahead`,
      createdAt: raisedAt
    }),
    describeClear: (poiId, { name }) => `Route hazard alarm cleared for ${poiId} ("${name}")`
  })

  /**
   * Build the notification message for a flagged point: type, name, distance,
   * and ETA. When a clearance `verdict` is supplied (a corridor bridge the
   * air-draft check found too low), a clause naming the clearance, the air
   * draft, and the margin is appended; otherwise the generic message stands.
   */
  function buildMessage (poi: CorridorPoi, verdict?: BridgeClearanceVerdict): string {
    const distance = formatDistance(poi.alongTrackDistanceMeters)
    const etaSeconds = toFiniteNumber(poi.etaSeconds)
    const eta = etaSeconds !== null && etaSeconds >= 0
      ? `, ETA ${formatEta(etaSeconds)}`
      : ''
    const base = `${poi.type} "${poi.name}" is on the route ahead, ${distance} away${eta}`
    if (verdict === undefined) {
      return base
    }
    const clearance = formatClearanceMeters(verdict.clearanceMeters)
    const airDraft = formatClearanceMeters(verdict.airDraftMeters)
    const margin = formatClearanceMeters(verdict.marginMeters)
    return `${base}: clearance ${clearance} m is at or below your air draft ${airDraft} m (+${margin} m margin)`
  }

  /**
   * Emit a `warn` notification for a flagged point with the given message.
   * `raisedAt` is the episode's first raise time, so a refresh keeps the
   * original `createdAt` rather than restarting the clock.
   */
  function emitWarn (poiId: string, message: string, raisedAt: string): void {
    const value: NotificationValue = {
      state: 'warn',
      method: ['visual'],
      message,
      createdAt: raisedAt
    }
    emitNotification(app, NOTIFICATION_PATH_PREFIX, poiId, value, SOURCE_SUFFIX)
  }

  function completeList (pois: PoiSummary[], listFetchedAt: number): RouteListScan {
    // Index the completed list, not the tick's raw one. The two differ only by
    // the points retention put back, and every one of those is already tracked
    // with a held summary that wins over this map, so the entry-and-hold path
    // reads the same either way. Indexing the completed list is what lets the
    // corridor bridge lookup share this map.
    const completed = completeWithRetained(tracker, pois, listFetchedAt)
    const summaries = new Map<string, PoiSummary>()
    for (const poi of completed) {
      summaries.set(poi.id, poi)
    }
    return { pois: completed, summaries, listFetchedAt }
  }

  function evaluate (
    scan: RouteListScan,
    corridorPois: CorridorPoi[],
    tooLow: ReadonlyMap<string, BridgeClearanceVerdict> = NO_CLEARANCE_VERDICTS
  ): void {
    // No route ahead: clear any still-active alarm and skip the per-tick map
    // allocation, mirroring the proximity alarm's empty-list guard.
    if (corridorPois.length === 0) {
      tracker.clearStale([])
      return
    }
    // The points flagged on this tick, keyed by id. The route-corridor scan
    // already deduplicates by id, but a defensive Map keeps the entry-and-exit
    // diff sound even if it did not.
    const flagged = new Map<string, CorridorPoi>()
    for (const poi of corridorPois) {
      flagged.set(poi.id, poi)
    }

    // A point now flagged is raised on first appearance, and its notification
    // is refreshed when the message changes, so the distance and ETA do not go
    // stale over a long approach to the point. A bridge crossing into or out of
    // the too-low set changes its message text too, so the same refresh path
    // upgrades it to (or back from) the clearance message.
    for (const poi of flagged.values()) {
      const message = buildMessage(poi, tooLow.get(poi.id))
      const existing = tracker.get(poi.id)
      if (existing === undefined || existing.message !== message) {
        // The tracker stamps `raisedAt` on the first set of the episode and
        // preserves it across this refresh overwrite, so the refreshed delta
        // keeps the original `createdAt`.
        const raisedAt = tracker.set(poi.id, {
          name: poi.name,
          message,
          // Hold the point by the summary the corridor scan projected it from.
          // `completeList` has already refreshed it for a point this tick's
          // list carried, so preferring the stored one keeps that fix.
          summary: existing?.summary ?? scan.summaries.get(poi.id),
          lastListedAt: existing?.lastListedAt ?? scan.listFetchedAt
        })
        emitWarn(poi.id, message, raisedAt)
        if (existing === undefined) {
          app.debug(`Route hazard alarm raised for ${poi.type} ${poi.id} ("${poi.name}")`)
        }
      }
    }

    // Exit: clear any alarming point no longer flagged. clearStale sanitizes
    // the kept ids into the tracker's key space, so a raw id and its wire
    // identity cannot disagree.
    tracker.clearStale(flagged.keys())
  }

  return { completeList, evaluate, clearAll: tracker.clearAll }
}
