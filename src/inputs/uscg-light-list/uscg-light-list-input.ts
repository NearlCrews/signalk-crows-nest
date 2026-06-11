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
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { clampRefreshHours, refreshHoursSchema } from '../../shared/refresh-hours.js'
import { USCG_LIGHT_LIST_SOURCE_ID } from '../../shared/source-ids.js'
import { MS_PER_HOUR, MS_PER_SECOND } from '../../shared/time.js'
import type { PluginConfig } from '../../shared/types.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'
import { clampMinimumYear, minimumYearSchema } from '../../shared/year-filter.js'

/** Delay before the first refresh fires after a plugin start, in seconds. */
const INITIAL_REFRESH_DELAY_SECONDS = 30

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
    const refreshHours = clampRefreshHours(config.uscgLightListRefreshHours)
    const intervalMs = refreshHours * MS_PER_HOUR
    const delayMs = INITIAL_REFRESH_DELAY_SECONDS * MS_PER_SECOND
    // In-flight guard: a refresh pass that takes longer than the configured
    // window (62 conditional GETs against a slow NAVCEN, fanned out four at a
    // time) would otherwise let the next setInterval tick start a concurrent
    // refreshAll, racing on store.upsertDistrict and clobbering each other's
    // writes. The guard skips overlapping ticks; the next interval fires
    // normally.
    let refreshing = false
    const runRefresh = (reason: string): void => {
      if (refreshing) {
        app.debug(`USCG Light List ${reason} skipped: previous refresh still running`)
        return
      }
      refreshing = true
      source.refreshAll()
        .catch(error => {
          app.debug(`USCG Light List ${reason} failed: ${String(error)}`)
        })
        .finally(() => { refreshing = false })
    }
    const initialTimer = setTimeout(() => { runRefresh('initial refresh') }, delayMs)
    const periodicTimer = setInterval(() => { runRefresh('refresh') }, intervalMs)
    const originalClose = source.close.bind(source)
    source.close = () => {
      clearTimeout(initialTimer)
      clearInterval(periodicTimer)
      originalClose()
    }
    return source
  }
}
