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
 * `notifications.navigation.activecaptain.route.<poiId>`, in the
 * `vessels.self` context. It carries `state: 'warn'` rather than `'alarm'`:
 * a hazard, bridge, or lock several miles ahead on the route is an advisory
 * the crew should plan around, not the imminent danger that the proximity
 * alarm signals. The SignalK severity order is nominal, normal, alert, warn,
 * alarm, then emergency, so `'warn'` correctly ranks below the proximity
 * alarm's `'alarm'`.
 */

import type { Delta, Path, SourceRef, Timestamp } from '@signalk/server-api'
import { PLUGIN_ID } from '../../shared/plugin-id.js'
import type { CorridorPoi } from '../../shared/types.js'

/** Path prefix for the per-point route notification, completed with the POI id. */
const NOTIFICATION_PATH_PREFIX = 'notifications.navigation.activecaptain.route.'

/** Meters in a kilometer, the threshold above which a distance is shown in km. */
const METERS_PER_KM = 1000

/** Seconds in a minute, used to format an ETA. */
const SECONDS_PER_MINUTE = 60

/** Minutes in an hour, used to format an ETA that runs past the hour. */
const MINUTES_PER_HOUR = 60

/**
 * Make a POI id safe to embed in a dot-delimited SignalK path. ActiveCaptain
 * ids are numeric, but `evaluate` is a public entry point: a stray `.` would
 * silently fork the notification onto a different path, so any character
 * outside `[A-Za-z0-9_-]` is replaced.
 */
function sanitizePoiId (poiId: string): string {
  return poiId.replace(/[^A-Za-z0-9_-]/g, '_')
}

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
 * pass a small stub. `handleMessage` is narrowed to the two-argument form (the
 * optional `skVersion` argument is unused: the notification path is v1).
 */
export interface RouteAlarmApp {
  handleMessage: (id: string, delta: Partial<Delta>) => void
  debug: (message: string) => void
}

/** Public surface of the route-corridor hazard alarms. */
export interface RouteHazardAlarms {
  /**
   * Evaluate the points of interest the route-corridor scan flagged for the
   * current tick, raising a notification for each one that has just appeared
   * on the route ahead and clearing each one that has just dropped off.
   */
  evaluate: (corridorPois: CorridorPoi[]) => void
  /**
   * Clear every notification currently in the alarm state. Called on plugin
   * stop so a stale route alarm does not linger after the monitor is gone.
   */
  clearAll: () => void
}

/**
 * The notification value emitted on a route-corridor path. This is a superset
 * of the SignalK `Notification` shape: it also carries a `timestamp`, matching
 * the proximity-alarm convention. It is a plain object, so it satisfies the
 * delta `Value` type.
 */
interface RouteNotificationValue {
  state: 'warn' | 'normal'
  method: Array<'visual' | 'sound'>
  message: string
  timestamp: string
}

/**
 * Create a route-corridor hazard alarm evaluator.
 *
 * @param app The SignalK app, used to emit notification deltas.
 */
export function createRouteHazardAlarms (app: RouteAlarmApp): RouteHazardAlarms {
  // Points of interest currently in the alarm state, keyed by POI id. The
  // value keeps the display name (for the clear message) and the last message
  // emitted, so the notification can be refreshed when the distance or ETA
  // changes without raising a fresh alarm.
  const active = new Map<string, { name: string, message: string }>()

  function emit (poiId: string, value: RouteNotificationValue): void {
    app.handleMessage(PLUGIN_ID, {
      updates: [{
        $source: PLUGIN_ID as SourceRef,
        timestamp: value.timestamp as Timestamp,
        values: [{
          path: `${NOTIFICATION_PATH_PREFIX}${sanitizePoiId(poiId)}` as Path,
          value
        }]
      }]
    })
  }

  /** Build the notification message for a flagged point: type, name, distance, and ETA. */
  function buildMessage (poi: CorridorPoi): string {
    const distance = formatDistance(poi.alongTrackDistanceMeters)
    const eta = typeof poi.etaSeconds === 'number' && Number.isFinite(poi.etaSeconds)
      ? `, ETA ${formatEta(poi.etaSeconds)}`
      : ''
    return `${poi.type} "${poi.name}" is on the route ahead, ${distance} away${eta}`
  }

  /** Emit a `warn` notification for a flagged point with the given message. */
  function emitWarn (poiId: string, message: string): void {
    emit(poiId, {
      state: 'warn',
      method: ['visual'],
      message,
      timestamp: new Date().toISOString()
    })
  }

  function clear (poiId: string, name: string): void {
    emit(poiId, {
      state: 'normal',
      method: [],
      message: `"${name}" is no longer on the route ahead`,
      timestamp: new Date().toISOString()
    })
    active.delete(poiId)
    app.debug(`Route hazard alarm cleared for ${poiId} ("${name}")`)
  }

  function evaluate (corridorPois: CorridorPoi[]): void {
    // The points flagged on this tick, keyed by id. The route-corridor scan
    // already deduplicates by id, but a defensive Map keeps the entry-and-exit
    // diff sound even if it did not.
    const flagged = new Map<string, CorridorPoi>()
    for (const poi of corridorPois) {
      flagged.set(poi.id, poi)
    }

    // A point now flagged is raised on first appearance, and its notification
    // is refreshed when the message changes, so the distance and ETA do not go
    // stale over a long approach to the point.
    for (const poi of flagged.values()) {
      const message = buildMessage(poi)
      const existing = active.get(poi.id)
      if (existing === undefined) {
        emitWarn(poi.id, message)
        active.set(poi.id, { name: poi.name, message })
        app.debug(`Route hazard alarm raised for ${poi.type} ${poi.id} ("${poi.name}")`)
      } else if (existing.message !== message) {
        emitWarn(poi.id, message)
        active.set(poi.id, { name: poi.name, message })
      }
    }

    // Exit: an alarming point that is no longer flagged. Snapshot the entries
    // first, since clear() mutates the map being iterated.
    for (const [poiId, entry] of [...active]) {
      if (!flagged.has(poiId)) {
        clear(poiId, entry.name)
      }
    }
  }

  function clearAll (): void {
    // Snapshot first: clear() deletes from the map as it goes.
    for (const [poiId, entry] of [...active]) {
      clear(poiId, entry.name)
    }
  }

  return { evaluate, clearAll }
}
