/**
 * Proximity hazard alarms.
 *
 * Given the vessel position and the nearby points of interest, this module
 * raises a SignalK notification for every Hazard within a configured radius.
 * It applies hysteresis: a notification is raised once when a hazard first
 * comes within the radius and cleared once it moves a margin beyond that
 * radius, so an alarm does not re-fire (or chatter) on every position update
 * while the hazard hovers near the boundary.
 *
 * The notification is emitted through `app.handleMessage` on the path
 * `notifications.navigation.activecaptain.hazard.<poiId>`, in the
 * `vessels.self` context (the default when a delta carries no context). The
 * `notifications.navigation` branch is the standard place for navigational
 * alerts, so consumers categorise it correctly.
 */

import type { Delta, Path, SourceRef, Timestamp } from '@signalk/server-api'
import { PLUGIN_ID } from '../../shared/plugin-id.js'
import { distanceMeters } from '../../geo/position-utilities.js'
import type { PoiSummary, Position } from '../../shared/types.js'

/** Path prefix for the per-hazard notification, completed with the POI id. */
const NOTIFICATION_PATH_PREFIX = 'notifications.navigation.activecaptain.hazard.'

/** The POI type that raises a proximity alarm. Other types are out of scope. */
const HAZARD_POI_TYPE = 'Hazard'

/**
 * Hysteresis margin: an active alarm clears only once the hazard is this
 * multiple of the alarm radius away. The gap between the raise distance and
 * the clear distance stops an alarm chattering when a hazard sits right on
 * the boundary.
 */
const EXIT_RADIUS_FACTOR = 1.2

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
 * The slice of the SignalK app the alarms need. The real `ServerAPI` satisfies
 * this structurally, so the plugin entrypoint passes `app` directly; tests
 * pass a small stub. `handleMessage` is narrowed to the two-argument form (the
 * optional `skVersion` argument is unused: the notification path is v1).
 */
export interface AlarmApp {
  handleMessage: (id: string, delta: Partial<Delta>) => void
  debug: (message: string) => void
}

/** Public surface of the proximity alarms. */
export interface ProximityAlarms {
  /**
   * Evaluate the hazards in `pois` against the vessel position, raising a
   * notification for each Hazard that has just come within the radius and
   * clearing each one that has just left. Non-Hazard POIs are ignored.
   */
  evaluate: (vesselPosition: Position, pois: PoiSummary[]) => void
  /**
   * Clear every notification currently in the alarm state. Called on plugin
   * stop so a stale hazard alarm does not linger after the monitor is gone.
   */
  clearAll: () => void
}

/**
 * The notification value emitted on the hazard path. This is a superset of the
 * SignalK `Notification` shape: it also carries a `timestamp`, per the Tier 1
 * design. It is a plain object, so it satisfies the delta `Value` type.
 */
interface HazardNotificationValue {
  state: 'alert' | 'normal'
  method: Array<'visual' | 'sound'>
  message: string
  timestamp: string
}

/**
 * Create a proximity-alarm evaluator.
 *
 * @param app          The SignalK app, used to emit notification deltas.
 * @param radiusMeters Hazards within this distance of the vessel raise an alarm.
 */
export function createProximityAlarms (app: AlarmApp, radiusMeters: number): ProximityAlarms {
  // Hazards currently in the alarm state, keyed by POI id, with the value the
  // hazard name. A hazard is added on entry and removed on exit, so an alarm
  // is raised and cleared exactly once per crossing of the radius boundary.
  const active = new Map<string, string>()

  function emit (poiId: string, value: HazardNotificationValue): void {
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

  function raise (poiId: string, name: string, distance: number): void {
    emit(poiId, {
      state: 'alert',
      method: ['visual', 'sound'],
      message: `Hazard "${name}" is ${Math.round(distance)} m away`,
      timestamp: new Date().toISOString()
    })
    active.set(poiId, name)
    app.debug(`Proximity alarm raised for hazard ${poiId} ("${name}") at ${Math.round(distance)} m`)
  }

  function clear (poiId: string, name: string): void {
    emit(poiId, {
      state: 'normal',
      method: [],
      message: `Hazard "${name}" is no longer nearby`,
      timestamp: new Date().toISOString()
    })
    active.delete(poiId)
    app.debug(`Proximity alarm cleared for hazard ${poiId} ("${name}")`)
  }

  const exitRadiusMeters = radiusMeters * EXIT_RADIUS_FACTOR

  function evaluate (vesselPosition: Position, pois: PoiSummary[]): void {
    // Hazards that should be alarming after this pass, with the distance kept
    // for the alarm message. A hazard not yet alarming must come inside the
    // raise radius; one already alarming stays until it passes the wider
    // clear radius, which is the hysteresis band.
    const inAlarm = new Map<string, { name: string, distance: number }>()
    for (const poi of pois) {
      if (poi.type !== HAZARD_POI_TYPE) {
        continue
      }
      const distance = distanceMeters(vesselPosition, poi.position)
      if (!Number.isFinite(distance)) {
        // A non-finite distance means a bad vessel or hazard coordinate.
        // Skipping it silently would drop a safety alarm, so log it.
        app.debug(`Proximity alarm skipped hazard ${poi.id}: non-finite distance`)
        continue
      }
      const threshold = active.has(poi.id) ? exitRadiusMeters : radiusMeters
      if (distance <= threshold) {
        inAlarm.set(poi.id, { name: poi.name, distance })
      }
    }

    // Entry: a hazard now in alarm that was not already alarming.
    for (const [poiId, { name, distance }] of inAlarm) {
      if (!active.has(poiId)) {
        raise(poiId, name, distance)
      }
    }

    // Exit: an alarming hazard that has left the clear radius. Snapshot the
    // entries first, since clear() mutates the map being iterated.
    for (const [poiId, name] of [...active]) {
      if (!inAlarm.has(poiId)) {
        clear(poiId, name)
      }
    }
  }

  function clearAll (): void {
    // Snapshot first: clear() deletes from the map as it goes.
    for (const [poiId, name] of [...active]) {
      clear(poiId, name)
    }
  }

  return { evaluate, clearAll }
}
