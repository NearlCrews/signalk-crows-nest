/**
 * USACE locks and dams input module.
 *
 * Opt-in: defaults off. Owns the config-schema fragment (enable toggle, the
 * per-layer lock and dam toggles, the refresh window, and the dedupe controls)
 * and the factory that wires the ArcGIS REST client and the PoiSource together.
 * USACE structures are US-only, so the vessel-position gate is read straight
 * off `InputContext.getCurrentPosition`: a vessel that has left US waters
 * issues no query until it returns.
 *
 * Dams default off: the National Inventory of Dams lists tens of thousands of
 * dams nationwide, most not on navigable water, so opting in floods the chart
 * and obscures the locks. Locks default on. This mirrors the NOAA ENC input,
 * whose heavy underwater-rocks layer defaults off for the same reason.
 */

import { createUsaceSource } from './usace-source.js'
import { createUsaceClient } from './usace-client.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'
import type { InputContext, InputModule } from '../poi-source.js'
import { clampBboxDebounceSeconds, DEFAULT_USACE_DEBOUNCE_SECONDS, refreshSecondsSchema } from '../../shared/bbox-debounce-bounds.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { USACE_SOURCE_ID } from '../../shared/source-ids.js'
import type { PluginConfig } from '../../shared/types.js'

/** The enable, per-layer, refresh, and dedupe config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  usaceEnabled: {
    type: 'boolean',
    title: 'Import locks and dams from the US Army Corps of Engineers (US only)',
    default: false
  },
  usaceIncludeLocks: {
    type: 'boolean',
    title: 'Include USACE navigation locks',
    default: true
  },
  usaceIncludeDams: {
    type: 'boolean',
    title: 'Include USACE dams (heavy: the National Inventory of Dams lists tens of thousands of dams, most not on navigable water)',
    default: false
  },
  usaceDedupe: dedupeToggleSchema(
    'Merge USACE structures that duplicate an ActiveCaptain marker'
  ),
  usaceDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for USACE structures, in meters'
  ),
  usaceRefreshSeconds: refreshSecondsSchema(
    'USACE bbox-debounce window, in seconds (0 to query upstream on every list call)',
    DEFAULT_USACE_DEBOUNCE_SECONDS
  )
}

/** The USACE locks and dams input module. */
export const usaceInput: InputModule = {
  id: USACE_SOURCE_ID,
  name: 'USACE locks and dams',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.usaceEnabled === true,
  // Dedupe defaults on: an absent toggle still merges USACE structures that
  // duplicate an ActiveCaptain marker. Only an explicit false turns it off,
  // matching the other non-base inputs.
  isDedupeEnabled: (config: PluginConfig) => config.usaceDedupe !== false,
  // Per-source merge radius surfaced on the USACE card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    cappedDedupeRadius(config.usaceDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { config, status, getCurrentPosition, dataDir } = context
    return createUsaceSource({
      client: createUsaceClient(),
      // Locks default on; dams default off (heavy). Only an explicit false
      // turns locks off, only an explicit true opts dams in.
      includeLocks: config.usaceIncludeLocks !== false,
      includeDams: config.usaceIncludeDams === true,
      refreshSeconds: clampBboxDebounceSeconds(
        config.usaceRefreshSeconds, DEFAULT_USACE_DEBOUNCE_SECONDS
      ),
      status,
      getCurrentPosition,
      dataDir
    })
  }
}
