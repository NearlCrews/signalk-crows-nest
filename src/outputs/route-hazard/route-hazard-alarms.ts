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
import { METERS_PER_KM } from '../../shared/length.js'
import { toFiniteNumber } from '../../shared/numbers.js'
import { MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '../../shared/time.js'
import type { CorridorPoi } from '../../shared/types.js'

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

/** Public surface of the route-corridor hazard alarms. */
export interface RouteHazardAlarms {
  /**
   * Evaluate the points of interest the route-corridor scan flagged for the
   * current tick, raising a notification for each one that has just appeared
   * on the route ahead and clearing each one that has just dropped off.
   *
   * `tooLow` maps the id of each corridor bridge the air-draft check found too
   * low to its clearance verdict; such a bridge gets a clearance-specific warn
   * message. It defaults to empty, so a caller with the bridge air-draft check
   * off (or no check at all) calls `evaluate(corridorPois)` and every point
   * keeps today's generic message.
   */
  evaluate: (corridorPois: CorridorPoi[], tooLow?: ReadonlyMap<string, BridgeClearanceVerdict>) => void
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
  // Each entry keeps the display name (for the clear message) and the last
  // message emitted (so the notification can be refreshed when the distance
  // or ETA changes without raising a fresh alarm); the tracker-stamped
  // `raisedAt` keeps `createdAt` at the episode start across refreshes and
  // the clear rather than resetting on every update.
  const tracker = createNotificationTracker<{ name: string, message: string }>({
    app,
    pathPrefix: NOTIFICATION_PATH_PREFIX,
    sourceSuffix: SOURCE_SUFFIX,
    buildClearValue: ({ name }, raisedAt) => ({
      state: 'normal',
      method: [],
      message: `"${name}" is no longer on the route ahead`,
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
    const eta = etaSeconds !== null ? `, ETA ${formatEta(etaSeconds)}` : ''
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

  function evaluate (
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
        const raisedAt = tracker.set(poi.id, { name: poi.name, message })
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

  return { evaluate, clearAll: tracker.clearAll }
}
