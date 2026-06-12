/**
 * Bridge air-draft output.
 *
 * A position-driven output: it raises a SignalK alarm when the vessel comes
 * within the configured radius of a bridge whose vertical clearance is at or
 * below the vessel air draft plus a safety margin. It contributes a
 * vessel-surroundings fetch box to the shared position monitor and evaluates
 * the bridge clearance alarms on every tick. Owns the
 * `enableBridgeAirDraftCheck`, `vesselAirDraftMeters`, and
 * `bridgeClearanceMarginMeters` config properties.
 *
 * The "near the vessel" radius is shared with the proximity hazard alarm: this
 * output reads `proximityAlarmRadiusMeters` rather than adding a fourth config
 * field, falling back to the same 500 m default when it is unset.
 */

import { createBridgeClearanceAlarms, BRIDGE_POI_TYPES } from './bridge-clearance-alarms.js'
import {
  clampClearanceMargin,
  readVesselAirDraft,
  enableBridgeAirDraftSchema,
  vesselAirDraftSchema,
  clearanceMarginSchema
} from '../../shared/bridge-clearance.js'
import { clampProximityAlarmRadius, vesselScanRadiusMeters } from '../../shared/proximity-radius.js'
import { positionToBbox } from '../../geo/position-utilities.js'
import type { OutputContext, OutputHandle, OutputModule, PositionScanContributor } from '../output.js'

/** The bridge air-draft config fragment, built from the shared schema builders. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  enableBridgeAirDraftCheck: enableBridgeAirDraftSchema(
    'Warn when an approaching bridge is at or below the vessel air draft (subscribes to the vessel position)'
  ),
  vesselAirDraftMeters: vesselAirDraftSchema(
    'Vessel air draft in meters (0 = use the SignalK design.airHeight)'
  ),
  bridgeClearanceMarginMeters: clearanceMarginSchema(
    'Bridge clearance safety margin in meters (allowance for tide, datum, and loading)'
  )
}

/** The bridge air-draft output module. */
export const bridgeAirDraftOutput: OutputModule = {
  id: 'bridge-air-draft',
  name: 'Bridge air-draft check',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config) => config.enableBridgeAirDraftCheck === true,
  start: (context: OutputContext): OutputHandle => {
    const { app, config } = context
    const marginMeters = clampClearanceMargin(config.bridgeClearanceMarginMeters)
    const fallbackAirDraftMeters = config.vesselAirDraftMeters
    const radiusMeters = clampProximityAlarmRadius(config.proximityAlarmRadiusMeters)
    // The scan box is wider than the alarm radius so a bridge (and its
    // ActiveCaptain clearance) is fetched well before it crosses the radius.
    const scanRadiusMeters = vesselScanRadiusMeters(radiusMeters)

    // Shared with the route-hazard output so the same bridge resolves once.
    const resolver = context.bridgeClearanceResolver
    const getAirDraft = (): number | null => readVesselAirDraft(app, fallbackAirDraftMeters)
    const alarms = createBridgeClearanceAlarms(app, { resolver, radiusMeters, marginMeters, getAirDraft })

    const positionScan: PositionScanContributor = {
      poiTypes: BRIDGE_POI_TYPES,
      buildFetchBox: (tickPosition) => positionToBbox(tickPosition, scanRadiusMeters),
      // alarms.evaluate is a closure, not a method, so it passes through
      // directly with no binding.
      evaluate: alarms.evaluate
    }
    return {
      stop: () => { alarms.clearAll() },
      positionScan
    }
  }
}
