/**
 * USCG Local Notice to Mariners input module.
 *
 * Opt-in: defaults off. Owns the config-schema fragment, the periodic refresh
 * scheduler (cleared on close), and the factory that wires the client, store,
 * and source together. The vessel-position gate is read straight off
 * `InputContext.getCurrentPosition`: a vessel that has left US waters keeps its
 * already-loaded notices but issues no refresh against NAVCEN until it returns.
 *
 * The refresh cadence is `uscgLnmRefreshSeconds`, clamped to the shared
 * bbox-debounce bounds. Unlike the at-runtime sources, where that value is a
 * per-viewport revalidation window, here it is the interval of a background
 * bulk re-download, so the `0` off sentinel (which disables a per-viewport
 * cache) instead falls back to the default cadence, since a zero-second
 * periodic interval is not a valid refresh period.
 */

import { createUscgLnmSource, type UscgLnmSource } from './uscg-lnm-source.js'
import { createLnmClient } from './lnm-client.js'
import { createLnmStore } from './lnm-store.js'

import type { InputContext, InputModule } from '../poi-source.js'
import { startRefreshScheduler } from '../refresh-scheduler.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { DEFAULT_USCG_LNM_DEBOUNCE_SECONDS, effectivePeriodicRefreshSeconds, refreshSecondsSchema } from '../../shared/bbox-debounce-bounds.js'
import { USCG_LNM_SOURCE_ID } from '../../shared/source-ids.js'
import { MS_PER_SECOND } from '../../shared/time.js'
import type { PluginConfig } from '../../shared/types.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'

/** The enable, dedupe, and refresh-cadence config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  uscgLnmEnabled: {
    type: 'boolean',
    title: 'Import live Local Notice to Mariners layers from USCG NAVCEN (US waters)',
    default: false
  },
  uscgLnmDedupe: dedupeToggleSchema(
    'Merge Local Notice to Mariners points of interest that duplicate an ActiveCaptain marker'
  ),
  uscgLnmDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for Local Notice to Mariners points of interest, in meters'
  ),
  uscgLnmRefreshSeconds: refreshSecondsSchema(
    'Local Notice to Mariners background refresh period, in seconds (0 uses the default cadence)',
    DEFAULT_USCG_LNM_DEBOUNCE_SECONDS
  )
}

/**
 * Resolve the refresh interval in milliseconds from the raw config value,
 * delegating the clamp and the zero-to-default rule to the shared
 * {@link effectivePeriodicRefreshSeconds} so the panel and the scheduler cannot
 * drift. Exported so a test can pin that resolution without standing up the
 * scheduler.
 */
export function refreshIntervalMs (raw: unknown): number {
  return effectivePeriodicRefreshSeconds(raw, DEFAULT_USCG_LNM_DEBOUNCE_SECONDS) * MS_PER_SECOND
}

/** The USCG Local Notice to Mariners input module. */
export const uscgLnmInput: InputModule = {
  id: USCG_LNM_SOURCE_ID,
  name: 'USCG Local Notice to Mariners',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.uscgLnmEnabled === true,
  // Dedupe defaults on: an absent toggle still merges LNM entries that
  // duplicate an ActiveCaptain marker. Only an explicit false turns it off,
  // matching the other non-base inputs.
  isDedupeEnabled: (config: PluginConfig) => config.uscgLnmDedupe !== false,
  // Per-source merge radius surfaced on the LNM card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    cappedDedupeRadius(config.uscgLnmDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { app, config, status, dataDir, getCurrentPosition } = context
    const client = createLnmClient()
    const store = createLnmStore(dataDir)
    // The on-disk load is kicked off here so a refresh fired by the scheduler
    // reads a hot index; failures are logged but do not block plugin start:
    // the store falls back to empty, which the next refresh repopulates.
    store.load().catch((error) => {
      app.debug(`USCG LNM index load failed: ${String(error)}`)
    })
    const source: UscgLnmSource = createUscgLnmSource({
      client,
      store,
      status,
      getCurrentPosition
    })
    const intervalMs = refreshIntervalMs(config.uscgLnmRefreshSeconds)
    // The scheduler owns the in-flight guard: a refresh pass that outruns the
    // configured window never lets the next tick start a concurrent refreshAll
    // that would race on the store writes.
    return startRefreshScheduler({ source, app, name: 'USCG LNM', intervalMs })
  }
}
