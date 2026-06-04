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
 * `notifications.navigation.crowsNest.hazard.<poiId>`, in the
 * `vessels.self` context (the default when a delta carries no context). The
 * `notifications.navigation` branch is the standard place for navigational
 * alerts, so consumers categorize it correctly.
 *
 * A raised alarm carries `state: 'alarm'`, the highest practical SignalK
 * severity here: a hazard within the radius of the bow is imminent danger.
 * The route-corridor output, by contrast, carries the lower `state: 'warn'`
 * for a hazard several miles ahead on the route, which is an advisory the
 * crew can plan around. The SignalK severity order is nominal, normal, alert,
 * warn, alarm, then emergency, so `'alarm'` correctly outranks the route
 * advisory's `'warn'`.
 */

import { emitNotification, type NotificationValue } from '../../shared/notification-path.js'
import { createNotificationTracker, type NotificationTrackerApp } from '../../shared/notification-tracker.js'
import { hysteresisThreshold } from '../../shared/proximity-radius.js'
import { distanceMeters } from '../../geo/position-utilities.js'
import { PROXIMITY_ALARM_POI_TYPE } from './poi-types.js'
import type { PoiSummary, Position } from '../../shared/types.js'

/** Path prefix for the per-hazard notification, completed with the POI id. */
const NOTIFICATION_PATH_PREFIX = 'notifications.navigation.crowsNest.hazard.'

/**
 * `$source` suffix appended to the plugin id, so consumers filtering by
 * source can tell proximity alarms from the route-corridor output even
 * though both come from this plugin.
 */
const SOURCE_SUFFIX = 'proximity'

/**
 * The slice of the SignalK app the alarms need. The real `ServerAPI` satisfies
 * this structurally, so the plugin entrypoint passes `app` directly; tests
 * pass a small stub.
 */
export type AlarmApp = NotificationTrackerApp

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
 * Create a proximity-alarm evaluator.
 *
 * @param app          The SignalK app, used to emit notification deltas.
 * @param radiusMeters Hazards within this distance of the vessel raise an alarm.
 */
export function createProximityAlarms (app: AlarmApp, radiusMeters: number): ProximityAlarms {
  // The tracker owns the active set and the clear half: a hazard is added on
  // entry and removed on exit, so an alarm is raised and cleared exactly once
  // per crossing of the radius boundary.
  const tracker = createNotificationTracker<{ name: string }>({
    app,
    pathPrefix: NOTIFICATION_PATH_PREFIX,
    sourceSuffix: SOURCE_SUFFIX,
    buildClearValue: ({ name }) => ({
      state: 'normal',
      method: [],
      message: `Hazard "${name}" is no longer nearby`,
      createdAt: new Date().toISOString()
    }),
    describeClear: (poiId, { name }) => `Proximity alarm cleared for hazard ${poiId} ("${name}")`
  })

  function raise (poiId: string, name: string, distance: number): void {
    const value: NotificationValue = {
      state: 'alarm',
      method: ['visual', 'sound'],
      message: `Hazard "${name}" is ${Math.round(distance)} m away`,
      createdAt: new Date().toISOString()
    }
    emitNotification(app, NOTIFICATION_PATH_PREFIX, poiId, value, SOURCE_SUFFIX)
    tracker.set(poiId, { name })
    app.debug(`Proximity alarm raised for hazard ${poiId} ("${name}") at ${Math.round(distance)} m`)
  }

  function evaluate (vesselPosition: Position, pois: PoiSummary[]): void {
    // Hazards that should be alarming after this pass, with the distance kept
    // for the alarm message. A hazard not yet alarming must come inside the
    // raise radius; one already alarming stays until it passes the wider
    // clear radius, which is the hysteresis band.
    const inAlarm = new Map<string, { name: string, distance: number }>()
    for (const poi of pois) {
      if (poi.type !== PROXIMITY_ALARM_POI_TYPE) {
        continue
      }
      const distance = distanceMeters(vesselPosition, poi.position)
      if (!Number.isFinite(distance)) {
        // A non-finite distance means a bad vessel or hazard coordinate.
        // Skipping it silently would drop a safety alarm, so log it.
        app.debug(`Proximity alarm skipped hazard ${poi.id}: non-finite distance`)
        continue
      }
      const threshold = hysteresisThreshold(radiusMeters, tracker.has(poi.id))
      if (distance <= threshold) {
        inAlarm.set(poi.id, { name: poi.name, distance })
      }
    }

    // Entry: a hazard now in alarm that was not already alarming.
    for (const [poiId, { name, distance }] of inAlarm) {
      if (!tracker.has(poiId)) {
        raise(poiId, name, distance)
      }
    }

    // Exit: clear any alarming hazard no longer in the in-alarm set. clearStale
    // sanitizes the kept ids into the tracker's key space, so a raw id and its
    // wire identity cannot disagree.
    tracker.clearStale(inAlarm.keys())
  }

  return { evaluate, clearAll: tracker.clearAll }
}
