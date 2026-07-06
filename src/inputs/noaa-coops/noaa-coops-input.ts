/**
 * NOAA CO-OPS input module.
 *
 * Opt-in: defaults off. Owns the config-schema fragment, the periodic refresh
 * scheduler (cleared on close), and the factory that wires the client, store,
 * and source together. The vessel-position gate is read straight off
 * `InputContext.getCurrentPosition`: a vessel that has left US waters keeps its
 * already-loaded index but issues no refresh against the mdapi until it returns.
 */

import { createNoaaCoopsSource } from './noaa-coops-source.js'
import type { NoaaCoopsSource } from './noaa-coops-source.js'
import { createCoopsClient } from './coops-client.js'
import { createCoopsStore } from './coops-store.js'
import type { CoopsStationType } from './noaa-coops-types.js'
import type { InputContext, InputModule } from '../poi-source.js'
import { startRefreshScheduler } from '../refresh-scheduler.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { clampRefreshHours, refreshHoursSchema } from '../../shared/refresh-hours.js'
import { NOAA_COOPS_SOURCE_ID } from '../../shared/source-ids.js'
import { MS_PER_HOUR } from '../../shared/time.js'
import type { PluginConfig } from '../../shared/types.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'

/** The enable, per-type, dedupe, and refresh config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  noaaCoopsEnabled: {
    type: 'boolean',
    title: 'Import tide and current stations from NOAA CO-OPS (US and territories)',
    default: false
  },
  noaaCoopsIncludeTideStations: {
    type: 'boolean',
    title: 'Include tide (water level) stations',
    default: true
  },
  noaaCoopsIncludeCurrentStations: {
    type: 'boolean',
    title: 'Include current-meter stations',
    default: true
  },
  noaaCoopsDedupe: dedupeToggleSchema(
    'Merge NOAA CO-OPS stations that duplicate an ActiveCaptain marker'
  ),
  noaaCoopsDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for NOAA CO-OPS stations, in meters'
  ),
  noaaCoopsRefreshHours: refreshHoursSchema('NOAA CO-OPS station-list background refresh period, in hours')
}

/** Resolve the enabled station types from the per-type config flags. */
function enabledStationTypes (config: PluginConfig): CoopsStationType[] {
  const types: CoopsStationType[] = []
  // Both families default on: an absent flag imports the family. Only an
  // explicit false turns one off.
  if (config.noaaCoopsIncludeTideStations !== false) types.push('tide')
  if (config.noaaCoopsIncludeCurrentStations !== false) types.push('current')
  return types
}

/** The NOAA CO-OPS input module. */
export const noaaCoopsInput: InputModule = {
  id: NOAA_COOPS_SOURCE_ID,
  name: 'NOAA CO-OPS',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.noaaCoopsEnabled === true,
  // Dedupe defaults on: an absent toggle still merges CO-OPS stations that
  // duplicate an ActiveCaptain marker. Only an explicit false turns it off,
  // matching the other non-base inputs.
  isDedupeEnabled: (config: PluginConfig) => config.noaaCoopsDedupe !== false,
  // Per-source merge radius surfaced on the CO-OPS card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    cappedDedupeRadius(config.noaaCoopsDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { app, config, status, dataDir, getCurrentPosition } = context
    const client = createCoopsClient()
    const store = createCoopsStore(dataDir)
    // The on-disk load is kicked off here so a refresh fired by the scheduler
    // reads a hot index; failures are logged but do not block plugin start: the
    // store falls back to an empty index, which the next successful refresh
    // repopulates from upstream.
    store.load().catch(error => {
      app.debug(`NOAA CO-OPS index load failed: ${String(error)}`)
    })
    const source: NoaaCoopsSource = createNoaaCoopsSource({
      client,
      store,
      stationTypes: enabledStationTypes(config),
      status,
      getCurrentPosition
    })
    const intervalMs = clampRefreshHours(config.noaaCoopsRefreshHours) * MS_PER_HOUR
    // The scheduler owns the in-flight guard: a refresh pass that outruns the
    // configured window never lets the next tick start a concurrent refreshAll
    // that would race on store.upsertType.
    return startRefreshScheduler({ source, app, name: 'NOAA CO-OPS', intervalMs })
  }
}
