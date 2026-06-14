/**
 * Route-hazard output.
 *
 * A position-driven output: it scans the active route ahead and raises a
 * SignalK route notification for each Hazard, Bridge, or Lock in the route
 * corridor. It contributes a route-corridor fetch box to the shared position
 * monitor and runs the corridor scan on every tick. Owns the
 * `enableRouteHazardScan` and `routeCorridorWidthMeters` config properties.
 *
 * The active route is read once per tick, in `buildFetchBox`, and reused in
 * `evaluate`, so a course delta arriving mid-tick cannot make the fetch box
 * and the scan disagree.
 */

import { createCourseReader } from './course-reader.js'
import { createRouteHazardAlarms, type BridgeClearanceVerdict } from './route-hazard-alarms.js'
import { CORRIDOR_POI_TYPES, routeLegPoints, scanRouteCorridor } from './route-corridor.js'
import type { OutputContext, OutputHandle, OutputModule, PositionScanContributor } from '../output.js'
import type { BridgeClearanceResolver } from '../bridge-air-draft/bridge-clearance-resolver.js'
import { BRIDGE_POI_TYPE } from '../bridge-air-draft/bridge-clearance-alarms.js'
import { bridgeBlocksVessel, clampClearanceMargin, readVesselAirDraft } from '../../shared/bridge-clearance.js'
import { distanceMeters, positionToBbox, unionBbox } from '../../geo/position-utilities.js'
import type { Bbox, CorridorPoi, PoiSummary, Position, RoutePolyline } from '../../shared/types.js'
import { clampRouteCorridorWidth, routeCorridorWidthSchema } from '../../shared/route-corridor.js'
import { METERS_PER_NAUTICAL_MILE } from '../../shared/length.js'

/**
 * How far ahead along the route, in meters, the fetch box is widened. Beyond
 * this cap the ActiveCaptain bounding-box endpoint clusters results, so the
 * look-ahead is a sliding window: a point past the cap is picked up on a
 * later tick.
 */
const ROUTE_LOOK_AHEAD_METERS = 10 * METERS_PER_NAUTICAL_MILE

/** The route-hazard config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  enableRouteHazardScan: {
    type: 'boolean',
    title: 'Scan the active route ahead for hazards, bridges, and locks (uses the Course API)',
    default: false
  },
  routeCorridorWidthMeters: routeCorridorWidthSchema(
    'Route corridor half-width in meters (a hazard is flagged within this distance either side of the route)'
  )
}

/**
 * Build a bounding box enclosing the route ahead, out to the look-ahead cap,
 * each route point expanded by the corridor half-width. Returns `null` when
 * the route carries no usable points. Lifted from the legacy position monitor.
 */
function routeCorridorBbox (route: RoutePolyline, corridorWidthMeters: number): Bbox | null {
  const points = routeLegPoints(route)

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
    if (traveledMeters >= ROUTE_LOOK_AHEAD_METERS) {
      break
    }
  }
  return box ?? null
}

/** Inputs for {@link resolveTooLowBridges}. */
export interface TooLowBridgeInput {
  /** The corridor points flagged for this tick; only `Bridge` points are tested. */
  corridorPois: CorridorPoi[]
  /** The tick's combined list result, used to resolve each bridge's clearance by id. */
  pois: PoiSummary[]
  /** The shared clearance resolver (synchronous summary hit, async ActiveCaptain detail). */
  resolver: BridgeClearanceResolver
  /** The vessel air draft, in meters, or `null` when unknown (the check is then inert). */
  airDraftMeters: number | null
  /** The clamped safety margin, in meters, added to the air draft for the comparison. */
  marginMeters: number
}

/**
 * Build the too-low-bridge verdict map the route-hazard alarms consume.
 *
 * The corridor scan emits {@link CorridorPoi}, which carries no clearance, so
 * the verdict is resolved here, between the scan and the alarms, keeping
 * `route-corridor.ts` pure geometry. Each corridor bridge's clearance is looked
 * up from its {@link PoiSummary} by id (the resolver takes a summary, not a
 * corridor point), and a bridge that {@link bridgeBlocksVessel} flags is
 * recorded with the figures the warn message needs. An unknown air draft, a
 * bridge with no matching summary, and an unknown clearance all yield no
 * verdict, so that bridge keeps the generic message.
 */
export function resolveTooLowBridges (input: TooLowBridgeInput): Map<string, BridgeClearanceVerdict> {
  const { corridorPois, pois, resolver, airDraftMeters, marginMeters } = input
  const tooLow = new Map<string, BridgeClearanceVerdict>()
  // An unknown air draft makes the check inert: no comparison, and no
  // ActiveCaptain detail fetches kicked off through the resolver this tick.
  if (airDraftMeters === null) {
    return tooLow
  }
  const bridges = corridorPois.filter((poi) => poi.type === BRIDGE_POI_TYPE)
  if (bridges.length === 0) {
    return tooLow
  }
  // The resolver works from the PoiSummary (which can carry the clearance, or
  // be the key the ActiveCaptain detail fetch is cached under), not the
  // clearance-free CorridorPoi, so index the tick's summaries by id.
  const bySummaryId = new Map<string, PoiSummary>()
  for (const summary of pois) {
    bySummaryId.set(summary.id, summary)
  }
  for (const poi of bridges) {
    const summary = bySummaryId.get(poi.id)
    if (summary === undefined) {
      continue
    }
    const clearanceMeters = resolver.clearanceMeters(summary)
    if (clearanceMeters === null) {
      continue
    }
    if (bridgeBlocksVessel(clearanceMeters, airDraftMeters, marginMeters)) {
      tooLow.set(poi.id, { clearanceMeters, airDraftMeters, marginMeters })
    }
  }
  return tooLow
}

/**
 * The bridge air-draft check's per-start state, built only when the check is
 * enabled (otherwise `null`). Bundling the resolver, margin, and air-draft
 * reader keeps all three out of scope when the check is off, so a disabled
 * check computes nothing.
 */
interface BridgeCheck {
  /** Resolves a corridor bridge's clearance (summary hit, or ActiveCaptain detail). */
  resolver: BridgeClearanceResolver
  /** The clamped safety margin, in meters, added to the air draft for the comparison. */
  marginMeters: number
  /** Read the current vessel air draft, in meters, or `null` when unknown. */
  getAirDraft: () => number | null
}

/** The route-hazard output module. */
export const routeHazardOutput: OutputModule = {
  id: 'route-hazard',
  name: 'Route-corridor hazard scan',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config) => config.enableRouteHazardScan === true,
  start: (context: OutputContext): OutputHandle => {
    const { app, config } = context
    const corridorWidthMeters = clampRouteCorridorWidth(config.routeCorridorWidthMeters)
    // The alarms are built before the course reader: createCourseReader opens
    // two Course API delta subscriptions, so if alarm construction were to
    // throw after that, those subscriptions would be orphaned with no stop()
    // handle. Constructing the alarms first keeps any throw subscription-free.
    const alarms = createRouteHazardAlarms(app)
    const courseReader = createCourseReader({ app })

    // The bridge air-draft check rides this existing route scan: when it is on,
    // a too-low bridge in the corridor gets a clearance-specific warn message.
    // The whole bundle is built only when the check is enabled, so a disabled
    // check computes nothing and the route scan behaves exactly as before. The
    // air draft is re-read each tick, so the check activates if `design.airHeight`
    // appears later in the voyage.
    const bridgeCheck: BridgeCheck | null = config.enableBridgeAirDraftCheck === true
      ? {
          // Shared with the bridge air-draft output so the same bridge
          // resolves once when both checks are enabled.
          resolver: context.bridgeClearanceResolver,
          marginMeters: clampClearanceMargin(config.bridgeClearanceMarginMeters),
          getAirDraft: () => readVesselAirDraft(app, config.vesselAirDraftMeters)
        }
      : null

    // The route read in buildFetchBox, reused in evaluate within the same tick.
    let tickRoute: RoutePolyline | null = null

    const positionScan: PositionScanContributor = {
      poiTypes: CORRIDOR_POI_TYPES,
      buildFetchBox: (tickPosition) => {
        // Pass the monitor's fresh tickPosition, not the independent
        // readPosition courseReader would otherwise take. If getSelfPath
        // transiently returns null/undefined (subscription warmup, missed
        // data-model write), the routeCorridorBbox would otherwise be sized
        // only around wp0 onward and miss a hazard sitting between the
        // vessel and the first waypoint. The bbox always covers the
        // vessel-to-wp0 segment the scan later projects onto.
        tickRoute = courseReader.getRouteAhead(tickPosition)
        if (tickRoute === null) {
          return null
        }
        return routeCorridorBbox(tickRoute, corridorWidthMeters)
      },
      evaluate: (vesselPosition, pois) => {
        let corridorPois: CorridorPoi[] = []
        if (tickRoute !== null) {
          const vesselState = courseReader.getVesselState()
          corridorPois = scanRouteCorridor({
            // Scan from the latest fix the monitor passes (which may have
            // advanced from the tickPosition the buildFetchBox saw, if the
            // list request was slow); the buildFetchBox box was already
            // sized to that earlier tickPosition.
            route: { ...tickRoute, vesselPosition },
            pois,
            corridorHalfWidthMeters: corridorWidthMeters,
            speedOverGround: vesselState.speedOverGround
          }).filter((poi) => poi.alongTrackDistanceMeters <= ROUTE_LOOK_AHEAD_METERS)
        }
        if (bridgeCheck === null) {
          alarms.evaluate(corridorPois)
          return
        }
        const tooLow = resolveTooLowBridges({
          corridorPois,
          pois,
          resolver: bridgeCheck.resolver,
          airDraftMeters: bridgeCheck.getAirDraft(),
          marginMeters: bridgeCheck.marginMeters
        })
        alarms.evaluate(corridorPois, tooLow)
      }
    }
    return {
      stop: () => {
        alarms.clearAll()
        courseReader.stop()
      },
      positionScan
    }
  }
}
