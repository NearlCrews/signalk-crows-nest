/**
 * USCG Light List input module.
 *
 * Opt-in: defaults off. Owns the config-schema fragment, the periodic
 * refresh scheduler (cleared on close), and the factory that wires the
 * client, store, and source together. The vessel-position gate is read
 * straight off `InputContext.getCurrentPosition`: a vessel that has left
 * US waters keeps its already-loaded index but issues no refresh against
 * NAVCEN until it returns.
 */

import { createUscgLightListSource } from './uscg-light-list-source.js'
import type { UscgLightListSource } from './uscg-light-list-source.js'
import { createLightListClient } from './light-list-client.js'
import { createLightListStore } from './light-list-store.js'
import type { InputContext, InputModule } from '../poi-source.js'
import { startRefreshScheduler } from '../refresh-scheduler.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { clampRefreshHours, refreshHoursSchema } from '../../shared/refresh-hours.js'
import { USCG_LIGHT_LIST_SOURCE_ID } from '../../shared/source-ids.js'
import { MS_PER_HOUR } from '../../shared/time.js'
import type { PluginConfig } from '../../shared/types.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'
import { clampMinimumYear, minimumYearSchema } from '../../shared/year-filter.js'

/** The enable, dedupe, and refresh-period config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  uscgLightListEnabled: {
    type: 'boolean',
    title: 'Import points of interest from the USCG Light List (US Aids to Navigation)',
    default: false
  },
  uscgLightListDedupe: dedupeToggleSchema(
    'Merge USCG Light List points of interest that duplicate an ActiveCaptain marker'
  ),
  uscgLightListDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for USCG Light List points of interest, in meters'
  ),
  uscgLightListRefreshHours: refreshHoursSchema('USCG Light List background refresh period, in hours'),
  uscgLightListMinimumUpdateYear: minimumYearSchema(
    'Earliest USCG Light List update year (0 to import every record)'
  )
}

/** The USCG Light List input module. */
export const uscgLightListInput: InputModule = {
  id: USCG_LIGHT_LIST_SOURCE_ID,
  name: 'USCG Light List',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.uscgLightListEnabled === true,
  // Dedupe defaults on: an absent toggle still merges Light List entries
  // that duplicate an ActiveCaptain marker. Only an explicit false turns
  // it off, matching the OpenSeaMap input.
  isDedupeEnabled: (config: PluginConfig) => config.uscgLightListDedupe !== false,
  // Per-source merge radius surfaced on the USCG card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    cappedDedupeRadius(config.uscgLightListDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { app, config, status, dataDir, getCurrentPosition } = context
    const client = createLightListClient()
    const store = createLightListStore(dataDir)
    // The on-disk load is kicked off here so a refresh fired by the
    // scheduler reads a hot index; failures are logged but do not block
    // plugin start: the store falls back to an empty index, which the
    // next successful refresh repopulates from upstream.
    store.load().catch(error => {
      app.debug(`USCG Light List index load failed: ${String(error)}`)
    })
    const source: UscgLightListSource = createUscgLightListSource({
      client,
      store,
      minimumYear: clampMinimumYear(config.uscgLightListMinimumUpdateYear),
      status,
      getCurrentPosition
    })
    const intervalMs = clampRefreshHours(config.uscgLightListRefreshHours) * MS_PER_HOUR
    // The scheduler owns the in-flight guard: a refresh pass that takes longer
    // than the configured window (62 conditional GETs against a slow NAVCEN,
    // fanned out four at a time) never lets the next tick start a concurrent
    // refreshAll that would race on store.upsertDistrict.
    return startRefreshScheduler({ source, app, name: 'USCG Light List', intervalMs })
  }
}
