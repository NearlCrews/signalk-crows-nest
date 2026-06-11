/**
 * Proximity-alarm output.
 *
 * A position-driven output: it raises a SignalK hazard notification when the
 * vessel comes within the configured radius of a Hazard point of interest. It
 * contributes a vessel-surroundings fetch box to the shared position monitor
 * and evaluates the proximity alarms on every tick. Owns the
 * `enableProximityAlarms` and `proximityAlarmRadiusMeters` config properties.
 */

import { createProximityAlarms } from './proximity-alarms.js'
import { PROXIMITY_ALARM_POI_TYPES } from './poi-types.js'
import type { OutputContext, OutputHandle, OutputModule, PositionScanContributor } from '../output.js'
import { positionToBbox } from '../../geo/position-utilities.js'
import { clampProximityAlarmRadius, proximityRadiusSchema, vesselScanRadiusMeters } from '../../shared/proximity-radius.js'

/** The proximity-alarm config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  enableProximityAlarms: {
    type: 'boolean',
    title: 'Emit a notification when the vessel nears a hazard (subscribes to the vessel position)',
    default: false
  },
  proximityAlarmRadiusMeters: proximityRadiusSchema('Proximity alarm radius in meters')
}

/** The proximity-alarm output module. */
export const proximityAlarmOutput: OutputModule = {
  id: 'proximity-alarm',
  name: 'Proximity hazard alarms',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config) => config.enableProximityAlarms === true,
  start: (context: OutputContext): OutputHandle => {
    const radiusMeters = clampProximityAlarmRadius(context.config.proximityAlarmRadiusMeters)
    // The scan box is wider than the alarm radius so a hazard is fetched well
    // before it crosses the radius. This mirrors the legacy monitor sizing.
    const scanRadiusMeters = vesselScanRadiusMeters(radiusMeters)
    const alarms = createProximityAlarms(context.app, radiusMeters)

    const positionScan: PositionScanContributor = {
      poiTypes: PROXIMITY_ALARM_POI_TYPES,
      buildFetchBox: (tickPosition) => positionToBbox(tickPosition, scanRadiusMeters),
      evaluate: (vesselPosition, pois) => { alarms.evaluate(vesselPosition, pois) }
    }
    return {
      stop: () => { alarms.clearAll() },
      positionScan
    }
  }
}
