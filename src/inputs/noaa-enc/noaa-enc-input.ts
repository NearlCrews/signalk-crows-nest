/**
 * NOAA ENC Direct input module.
 *
 * Opt-in: defaults off. Owns the config-schema fragment (enable toggle,
 * dedupe toggle, scale-band selector, and three per-layer toggles) and the
 * factory that wires the ArcGIS REST client and the PoiSource together.
 * The vessel-position gate is read straight off
 * `InputContext.getCurrentPosition`: a vessel that has left US waters
 * issues no list query against NOAA until it returns.
 */

import { createNoaaEncSource } from './noaa-enc-source.js'
import { createEncDirectClient } from './enc-direct-client.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'
import { SCALE_BANDS, DEFAULT_SCALE_BAND, resolveScaleBand } from '../../shared/scale-band.js'
import type { InputContext, InputModule } from '../poi-source.js'
import {
  clampBboxDebounceSeconds,
  DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS,
  refreshSecondsSchema
} from '../../shared/bbox-debounce-bounds.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { NOAA_ENC_SOURCE_ID } from '../../shared/source-ids.js'
import type { PluginConfig } from '../../shared/types.js'
import { clampMinimumYear, minimumYearSchema } from '../../shared/year-filter.js'

/** The enable, dedupe, scale-band, and per-layer config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  noaaEncEnabled: {
    type: 'boolean',
    title: 'Import wrecks, obstructions, and rocks from NOAA ENC Direct (US authoritative)',
    default: false
  },
  noaaEncDedupe: dedupeToggleSchema(
    'Merge NOAA ENC points of interest that duplicate an ActiveCaptain marker'
  ),
  noaaEncDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for NOAA ENC points of interest, in meters'
  ),
  noaaEncScaleBand: {
    type: 'string',
    title: 'NOAA ENC chart scale band',
    enum: [...SCALE_BANDS],
    default: DEFAULT_SCALE_BAND
  },
  noaaEncIncludeWrecks: {
    type: 'boolean',
    title: 'Include NOAA ENC wrecks',
    default: true
  },
  noaaEncIncludeObstructions: {
    type: 'boolean',
    title: 'Include NOAA ENC obstructions',
    default: true
  },
  noaaEncIncludeRocks: {
    type: 'boolean',
    title: 'Include NOAA ENC underwater rocks (heavy: a coastal-band query can return tens of thousands)',
    default: false
  },
  noaaEncMinimumSurveyYear: minimumYearSchema(
    'Earliest NOAA ENC survey year (0 to import every survey)'
  ),
  noaaEncRefreshSeconds: refreshSecondsSchema(
    'NOAA ENC bbox-debounce window, in seconds (0 to query upstream on every list call)',
    DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS
  )
}

/** The NOAA ENC Direct input module. */
export const noaaEncInput: InputModule = {
  id: NOAA_ENC_SOURCE_ID,
  name: 'NOAA ENC Direct',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.noaaEncEnabled === true,
  // Dedupe defaults on: an absent toggle still merges NOAA ENC entries that
  // duplicate an ActiveCaptain marker. Only an explicit false turns it off,
  // matching the OpenSeaMap and Light List inputs.
  isDedupeEnabled: (config: PluginConfig) => config.noaaEncDedupe !== false,
  // Per-source merge radius surfaced on the NOAA card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    cappedDedupeRadius(config.noaaEncDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { config, status, getCurrentPosition, dataDir } = context
    return createNoaaEncSource({
      client: createEncDirectClient(),
      band: resolveScaleBand(config.noaaEncScaleBand),
      // Wrecks and obstructions default on; only an explicit false turns
      // them off. Rocks default off because a coastal-band query can return
      // tens of thousands of underwater rocks; only an explicit true opts in.
      includeWrecks: config.noaaEncIncludeWrecks !== false,
      includeObstructions: config.noaaEncIncludeObstructions !== false,
      includeRocks: config.noaaEncIncludeRocks === true,
      minimumYear: clampMinimumYear(config.noaaEncMinimumSurveyYear),
      refreshSeconds: clampBboxDebounceSeconds(
        config.noaaEncRefreshSeconds, DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS
      ),
      status,
      getCurrentPosition,
      dataDir
    })
  }
}
