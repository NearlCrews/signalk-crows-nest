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

import { createNoaaEncSource, NOAA_ENC_SOURCE_ID } from './noaa-enc-source.js'
import { createEncDirectClient } from './enc-direct-client.js'
import type { ScaleBand } from './enc-direct-types.js'
import type { InputContext, InputModule } from '../poi-source.js'
import type { PluginConfig } from '../../shared/types.js'
import {
  clampMinimumYear,
  DEFAULT_MINIMUM_YEAR,
  MAX_YEAR,
  MIN_YEAR
} from '../../shared/year-filter.js'

/** The six ENC Direct scale bands, ordered overview to berthing. */
const SCALE_BANDS: readonly ScaleBand[] = [
  'overview', 'general', 'coastal', 'approach', 'harbour', 'berthing'
]

/** Default scale band when the configuration omits one. */
const DEFAULT_SCALE_BAND: ScaleBand = 'coastal'

/**
 * Default and bounds for the per-bbox debounce period. The default of 30 s
 * matches a reasonable Freeboard refresh cadence: a stationary user can pan
 * around the same viewport without re-firing ENC requests every keystroke,
 * but a user who has moved to a new view sees fresh data within seconds.
 * The bounds prevent a hand-edited config from disabling all queries (high
 * bound) or asking for an impractical sub-second debounce (low bound).
 */
const DEFAULT_REFRESH_SECONDS = 30
const MIN_REFRESH_SECONDS = 0
const MAX_REFRESH_SECONDS = 600

/** The enable, dedupe, scale-band, and per-layer config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  noaaEncEnabled: {
    type: 'boolean',
    title: 'Import wrecks, obstructions, and rocks from NOAA ENC Direct (US authoritative)',
    default: false
  },
  noaaEncDedupe: {
    type: 'boolean',
    title: 'Merge NOAA ENC points of interest that duplicate an ActiveCaptain marker',
    default: true
  },
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
  noaaEncMinimumSurveyYear: {
    type: 'number',
    title: 'Earliest NOAA ENC survey year (0 to import every survey)',
    default: DEFAULT_MINIMUM_YEAR,
    minimum: MIN_YEAR,
    maximum: MAX_YEAR
  },
  noaaEncRefreshSeconds: {
    type: 'number',
    title: 'NOAA ENC bbox-debounce window, in seconds (0 to query upstream on every list call)',
    default: DEFAULT_REFRESH_SECONDS,
    minimum: MIN_REFRESH_SECONDS,
    maximum: MAX_REFRESH_SECONDS
  }
}

/** Clamp a raw refresh-seconds value, falling back to the default on garbage. */
function resolveRefreshSeconds (raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_REFRESH_SECONDS
  if (raw < MIN_REFRESH_SECONDS) return MIN_REFRESH_SECONDS
  if (raw > MAX_REFRESH_SECONDS) return MAX_REFRESH_SECONDS
  return Math.trunc(raw)
}

/** Resolve the scale band from raw config, falling back to the default. */
function resolveBand (raw: unknown): ScaleBand {
  if (typeof raw !== 'string') {
    return DEFAULT_SCALE_BAND
  }
  return (SCALE_BANDS as readonly string[]).includes(raw)
    ? raw as ScaleBand
    : DEFAULT_SCALE_BAND
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
  createSource: (context: InputContext) => {
    const { config, status, getCurrentPosition } = context
    return createNoaaEncSource({
      client: createEncDirectClient(),
      band: resolveBand(config.noaaEncScaleBand),
      // Wrecks and obstructions default on; only an explicit false turns
      // them off. Rocks default off because a coastal-band query can return
      // tens of thousands of underwater rocks; only an explicit true opts in.
      includeWrecks: config.noaaEncIncludeWrecks !== false,
      includeObstructions: config.noaaEncIncludeObstructions !== false,
      includeRocks: config.noaaEncIncludeRocks === true,
      minimumYear: clampMinimumYear(config.noaaEncMinimumSurveyYear),
      refreshSeconds: resolveRefreshSeconds(config.noaaEncRefreshSeconds),
      status,
      getCurrentPosition
    })
  }
}
