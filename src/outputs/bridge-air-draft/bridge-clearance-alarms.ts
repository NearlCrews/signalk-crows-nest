/**
 * Bridge clearance alarms.
 *
 * Given the vessel position and the nearby points of interest, this module
 * raises a SignalK notification for every Bridge whose vertical clearance is at
 * or below the vessel air draft plus the configured safety margin, while the
 * bridge is within a configured radius of the vessel. It mirrors the proximity
 * hazard alarms: the same hysteresis (raise once on entry, clear once after the
 * bridge passes a wider exit radius) keeps an alarm from chattering when a
 * bridge sits right on the boundary.
 *
 * Two facts make this distinct from the proximity alarm. First, the comparison
 * needs the vessel air draft, read fresh on every pass via `getAirDraft` so the
 * check follows a changing `design.airHeight`. When the air draft is unknown
 * (no `design.airHeight` and no configured fallback) the check is inert: it
 * raises nothing, clears any alarm raised while the air draft was known, and
 * logs the transition once. Second, the clearance is resolved through a shared
 * `BridgeClearanceResolver`, which returns OpenSeaMap clearances synchronously
 * and resolves ActiveCaptain clearances from a cached detail fetch.
 *
 * The notification is emitted on the path
 * `notifications.navigation.crowsNest.bridgeClearance.<poiId>`, in the
 * `vessels.self` context, with `$source` suffix `bridge`. A raised alarm
 * carries `state: 'alarm'`: a too-low bridge within the radius of the bow is
 * imminent danger, the same severity the proximity hazard alarm raises.
 */

import { emitNotification, type NotificationValue } from '../../shared/notification-path.js'
import { createNotificationTracker, type NotificationTrackerApp } from '../../shared/notification-tracker.js'
import { bridgeBlocksVessel, formatMeters } from '../../shared/bridge-clearance.js'
import { hysteresisThreshold } from '../../shared/proximity-radius.js'
import { distanceMeters } from '../../geo/position-utilities.js'
import type { BridgeClearanceResolver } from './bridge-clearance-resolver.js'
import type { PoiSummary, PoiType, Position } from '../../shared/types.js'

/** POI type the bridge air-draft check acts on. Bridges are the only in-scope type. */
export const BRIDGE_POI_TYPE: PoiType = 'Bridge'

/** Tuple form of the above, for the `PositionScanContributor.poiTypes` field. */
export const BRIDGE_POI_TYPES = [BRIDGE_POI_TYPE] as const satisfies readonly PoiType[]

/** Path prefix for the per-bridge notification, completed with the POI id. */
const NOTIFICATION_PATH_PREFIX = 'notifications.navigation.crowsNest.bridgeClearance.'

/**
 * `$source` suffix appended to the plugin id, so consumers filtering by source
 * can tell a bridge clearance alarm from the proximity hazard alarm and the
 * route-corridor output even though all three come from this plugin.
 */
const SOURCE_SUFFIX = 'bridge'

/**
 * The slice of the SignalK app the alarms need. The real `ServerAPI` satisfies
 * this structurally, so the output passes `app` directly; tests pass a stub.
 */
export type BridgeAlarmApp = NotificationTrackerApp

/** Inputs for {@link createBridgeClearanceAlarms}. */
export interface BridgeClearanceAlarmOptions {
  /** Resolves a bridge's vertical clearance, in meters, or `null` when unknown. */
  resolver: BridgeClearanceResolver
  /** Bridges within this distance of the vessel raise an alarm when too low. */
  radiusMeters: number
  /** Safety margin, in meters, added to the air draft before the comparison. */
  marginMeters: number
  /** Read the current vessel air draft, in meters, or `null` when unknown. */
  getAirDraft: () => number | null
}

/** Public surface of the bridge clearance alarms. */
export interface BridgeClearanceAlarms {
  /**
   * Evaluate the bridges in `pois` against the vessel position, raising a
   * notification for each too-low bridge that has just come within the radius
   * and clearing each one that has just left. Non-Bridge POIs are ignored.
   * When the vessel air draft is unknown the check is inert: it raises nothing
   * and clears any active alarm.
   */
  evaluate: (vesselPosition: Position, pois: PoiSummary[]) => void
  /**
   * Clear every notification currently in the alarm state. Called on plugin
   * stop so a stale bridge alarm does not linger after the monitor is gone.
   */
  clearAll: () => void
}

/** An in-alarm bridge for this pass, with the figures the alarm message needs. */
interface InAlarmEntry {
  name: string
  clearanceMeters: number
  airDraftMeters: number
  distanceMeters: number
}

/**
 * Create a bridge clearance alarm evaluator.
 *
 * @param app     The SignalK app, used to emit notification deltas and to log.
 * @param options The resolver, radius, margin, and air-draft reader.
 */
export function createBridgeClearanceAlarms (
  app: BridgeAlarmApp,
  options: BridgeClearanceAlarmOptions
): BridgeClearanceAlarms {
  const { resolver, radiusMeters, marginMeters, getAirDraft } = options

  // The tracker owns the active set, the clear half, and the episode clock:
  // a bridge is added on entry and removed on exit, so an alarm is raised and
  // cleared exactly once per crossing of the radius boundary, and the
  // tracker-stamped `raisedAt` keeps `createdAt` at the episode start on the
  // clear delta rather than resetting to the clear time.
  const tracker = createNotificationTracker<{ name: string }>({
    app,
    pathPrefix: NOTIFICATION_PATH_PREFIX,
    sourceSuffix: SOURCE_SUFFIX,
    buildClearValue: ({ name }, raisedAt) => ({
      state: 'normal',
      method: [],
      message: `Bridge "${name}" clearance alarm cleared`,
      createdAt: raisedAt
    }),
    describeClear: (poiId, { name }) => `Bridge clearance alarm cleared for bridge ${poiId} ("${name}")`
  })

  // Tracks whether the air draft was available on the previous pass, so the
  // inert/active transition is logged once rather than on every tick. `null`
  // means no pass has run yet, so the first pass always logs its state.
  let airDraftAvailable: boolean | null = null

  function raise (poiId: string, entry: InAlarmEntry): void {
    const { name, clearanceMeters, airDraftMeters, distanceMeters: distance } = entry
    const raisedAt = tracker.set(poiId, { name })
    const value: NotificationValue = {
      state: 'alarm',
      method: ['visual', 'sound'],
      message:
        `Bridge "${name}" clearance ${formatMeters(clearanceMeters)} m is at or below ` +
        `your air draft ${formatMeters(airDraftMeters)} m (+${formatMeters(marginMeters)} m margin), ` +
        `${Math.round(distance)} m away`,
      createdAt: raisedAt
    }
    emitNotification(app, NOTIFICATION_PATH_PREFIX, poiId, value, SOURCE_SUFFIX)
    app.debug(
      `Bridge clearance alarm raised for bridge ${poiId} ("${name}"): ` +
      `clearance ${formatMeters(clearanceMeters)} m vs air draft ${formatMeters(airDraftMeters)} m ` +
      `at ${Math.round(distance)} m`
    )
  }

  function evaluate (vesselPosition: Position, pois: PoiSummary[]): void {
    const airDraftMeters = getAirDraft()
    const available = airDraftMeters !== null
    if (available !== airDraftAvailable) {
      app.debug(airDraftMeters !== null
        ? `Bridge air-draft check active: comparing bridge clearances against ${formatMeters(airDraftMeters)} m air draft`
        : 'Bridge air-draft check inert: no design.airHeight and no configured fallback air draft')
      airDraftAvailable = available
    }
    if (airDraftMeters === null) {
      // The check cannot run without an air draft, so clear any alarm raised
      // while it was known rather than leaving it stuck on.
      tracker.clearAll()
      return
    }

    // Bridges that should be alarming after this pass, with the figures kept for
    // the alarm message. A bridge not yet alarming must come inside the raise
    // radius; one already alarming holds until it passes the wider clear radius.
    const inAlarm = new Map<string, InAlarmEntry>()
    for (const poi of pois) {
      if (poi.type !== BRIDGE_POI_TYPE) {
        continue
      }
      // Resolve every bridge in the scan box, warming the resolver cache so an
      // ActiveCaptain bridge's clearance is known by the time it reaches the
      // alarm radius rather than a tick later.
      const clearanceMeters = resolver.clearanceMeters(poi)
      const distance = distanceMeters(vesselPosition, poi.position)
      if (!Number.isFinite(distance)) {
        // A non-finite distance means a bad vessel or bridge coordinate.
        // Skipping it silently would drop a safety alarm, so log it.
        app.debug(`Bridge clearance alarm skipped bridge ${poi.id}: non-finite distance`)
        continue
      }
      const threshold = hysteresisThreshold(radiusMeters, tracker.has(poi.id))
      if (distance > threshold) {
        continue
      }
      if (clearanceMeters === null) {
        // Unknown clearance: the bridge stays silent (it is still a normal POI).
        continue
      }
      if (!bridgeBlocksVessel(clearanceMeters, airDraftMeters, marginMeters)) {
        continue
      }
      inAlarm.set(poi.id, { name: poi.name, clearanceMeters, airDraftMeters, distanceMeters: distance })
    }

    // Entry: a bridge now in alarm that was not already alarming.
    for (const [poiId, entry] of inAlarm) {
      if (!tracker.has(poiId)) {
        raise(poiId, entry)
      }
    }

    // Exit: clear any alarming bridge no longer in the in-alarm set (left the
    // clear radius or no longer blocks). clearStale sanitizes the kept ids into
    // the tracker's key space, so a raw id and its wire identity cannot disagree.
    tracker.clearStale(inAlarm.keys())
  }

  return { evaluate, clearAll: tracker.clearAll }
}
