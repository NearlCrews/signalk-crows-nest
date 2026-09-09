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
 * The tick's list is completed with every alarming bridge the list omitted,
 * held at the position a list last reported it at, because an aggregate list
 * result is legitimately partial and absence from one is not evidence that the
 * vessel has passed a bridge. See `alarm-retention.ts`.
 *
 * The notification is emitted on the path
 * `notifications.navigation.crowsNest.bridgeClearance.<poiId>`, in the
 * `vessels.self` context, with `$source` suffix `bridge`. A raised alarm
 * carries `state: 'alarm'`: a too-low bridge within the radius of the bow is
 * imminent danger, the same severity the proximity hazard alarm raises.
 */

import { emitNotification, type NotificationValue } from '../../shared/notification-path.js'
import { createNotificationTracker, type NotificationTrackerApp } from '../../shared/notification-tracker.js'
import { bridgeBlocksVessel, formatClearanceMeters } from '../../shared/bridge-clearance.js'
import { hysteresisThreshold } from '../../shared/proximity-radius.js'
import { distanceMeters } from '../../geo/position-utilities.js'
import { completeWithRetained, unconfirmedClearReason, type RetainedPoi } from '../alarm-retention.js'
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
   * and clears any active alarm. `listFetchedAt` is when the request behind
   * `pois` landed, which the reconfirmation window runs on.
   */
  evaluate: (vesselPosition: Position, pois: PoiSummary[], listFetchedAt: number) => void
  /**
   * Clear every notification currently in the alarm state. Called on plugin
   * stop so a stale bridge alarm does not linger after the monitor is gone.
   */
  clearAll: () => void
}

/** What the tracker holds for an alarming bridge: always raised off a list entry. */
interface BridgeEntry extends RetainedPoi {
  summary: PoiSummary
}

/** An in-alarm bridge for this pass, with the figures the alarm message needs. */
interface InAlarmEntry {
  poi: PoiSummary
  clearanceMeters: number
  airDraftMeters: number
  rangeMeters: number
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

  // Tracker-owned raise-once/clear-once hysteresis and episode clock, same
  // shape as the proximity alarm (see proximity-alarms.ts), with a bridge as
  // the tracked subject, and the same hold across a partial list result.
  const tracker = createNotificationTracker<BridgeEntry>({
    app,
    pathPrefix: NOTIFICATION_PATH_PREFIX,
    sourceSuffix: SOURCE_SUFFIX,
    buildClearValue: ({ summary, unconfirmed }, raisedAt) => ({
      state: 'normal',
      method: [],
      message: unconfirmed === true
        // The vessel has not passed this bridge, so the clear must not read as
        // though it had.
        ? `Bridge "${summary.name}" clearance alarm cleared: ${unconfirmedClearReason('within the alarm radius')}`
        : `Bridge "${summary.name}" clearance alarm cleared`,
      createdAt: raisedAt
    }),
    describeClear: (poiId, { summary }) => `Bridge clearance alarm cleared for bridge ${poiId} ("${summary.name}")`
  })

  // Tracks whether the air draft was available on the previous pass, so the
  // inert/active transition is logged once rather than on every tick. `null`
  // means no pass has run yet, so the first pass always logs its state.
  let airDraftAvailable: boolean | null = null

  // The list result the box was last warmed for, so a replay of that result
  // does not warm it again. Undefined until the first warm, so no clock value
  // doubles as a sentinel meaning "not yet".
  let warmedListFetchedAt: number | undefined

  function raise (entry: InAlarmEntry, listFetchedAt: number): void {
    const { poi, clearanceMeters, airDraftMeters, rangeMeters: distance } = entry
    const { id: poiId, name } = poi
    const raisedAt = tracker.set(poiId, { summary: poi, lastListedAt: listFetchedAt })
    const value: NotificationValue = {
      state: 'alarm',
      method: ['visual', 'sound'],
      message:
        `Bridge "${name}" clearance ${formatClearanceMeters(clearanceMeters)} m is at or below ` +
        `your air draft ${formatClearanceMeters(airDraftMeters)} m (+${formatClearanceMeters(marginMeters)} m margin), ` +
        `${Math.round(distance)} m away`,
      createdAt: raisedAt
    }
    emitNotification(app, NOTIFICATION_PATH_PREFIX, poiId, value, SOURCE_SUFFIX)
    app.debug(
      `Bridge clearance alarm raised for bridge ${poiId} ("${name}"): ` +
      `clearance ${formatClearanceMeters(clearanceMeters)} m vs air draft ${formatClearanceMeters(airDraftMeters)} m ` +
      `at ${Math.round(distance)} m`
    )
  }

  function evaluate (vesselPosition: Position, pois: PoiSummary[], listFetchedAt: number): void {
    const airDraftMeters = getAirDraft()
    const available = airDraftMeters !== null
    if (available !== airDraftAvailable) {
      app.debug(airDraftMeters !== null
        ? `Bridge air-draft check active: comparing bridge clearances against ${formatClearanceMeters(airDraftMeters)} m air draft`
        : 'Bridge air-draft check inert: no design.airHeight and no configured fallback air draft')
      airDraftAvailable = available
    }
    if (airDraftMeters === null) {
      // The check cannot run without an air draft, so clear any alarm raised
      // while it was known rather than leaving it stuck on.
      tracker.clearAll()
      return
    }
    // Hold every alarming bridge the list omitted at its last reported
    // position, so the exit decision below rests on where the bridge is rather
    // than on whether a partial upstream result happened to mention it. The
    // window runs on when the request behind this list landed, not on this
    // call: the monitor replays one result across many evaluations, and a
    // replay is not a fresh report.
    const scanned = completeWithRetained(tracker, pois, listFetchedAt)
    if (scanned.length === 0) {
      tracker.clearStale([])
      return
    }

    // Warming the whole box is worth one pass per list result: an
    // ActiveCaptain bridge's clearance is then known by the time the bridge
    // reaches the alarm radius rather than a tick later. It is not worth
    // repeating on a replay of that result. The list has not changed, so a
    // resolvable bridge answers from cache and an unresolvable one starts a
    // fresh detail fetch, which the resolver deliberately does not suppress: at
    // an evaluation every ten to thirty seconds that is several times the
    // request rate the upstream saw when evaluation ran once a minute. Between
    // requests, only the bridges that could alarm on this pass are resolved.
    const warmingBox = listFetchedAt !== warmedListFetchedAt
    warmedListFetchedAt = listFetchedAt

    // Bridges that should be alarming after this pass, with the figures kept for
    // the alarm message. A bridge not yet alarming must come inside the raise
    // radius; one already alarming holds until it passes the wider clear radius.
    const inAlarm = new Map<string, InAlarmEntry>()
    for (const poi of scanned) {
      if (poi.type !== BRIDGE_POI_TYPE) {
        continue
      }
      const distance = distanceMeters(vesselPosition, poi.position)
      const threshold = hysteresisThreshold(radiusMeters, tracker.has(poi.id))
      const inRange = Number.isFinite(distance) && distance <= threshold
      if (!warmingBox && !inRange) {
        continue
      }
      const clearanceMeters = resolver.clearanceMeters(poi)
      if (!Number.isFinite(distance)) {
        // A non-finite distance means a bad vessel or bridge coordinate.
        // Skipping it silently would drop a safety alarm, so log it.
        app.debug(`Bridge clearance alarm skipped bridge ${poi.id}: non-finite distance`)
        continue
      }
      if (!inRange) {
        continue
      }
      if (clearanceMeters === null) {
        // Unknown clearance: the bridge stays silent (it is still a normal POI).
        continue
      }
      if (!bridgeBlocksVessel(clearanceMeters, airDraftMeters, marginMeters)) {
        continue
      }
      inAlarm.set(poi.id, { poi, clearanceMeters, airDraftMeters, rangeMeters: distance })
    }

    // Entry: a bridge now in alarm that was not already alarming.
    for (const entry of inAlarm.values()) {
      if (!tracker.has(entry.poi.id)) {
        raise(entry, listFetchedAt)
      }
    }

    // Exit: clear any alarming bridge no longer in the in-alarm set (left the
    // clear radius or no longer blocks). clearStale sanitizes the kept ids into
    // the tracker's key space, so a raw id and its wire identity cannot disagree.
    tracker.clearStale(inAlarm.keys())
  }

  return { evaluate, clearAll: tracker.clearAll }
}
