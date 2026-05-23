/**
 * OpenSeaMap input module.
 *
 * Registers OpenSeaMap (OpenStreetMap marine data, fetched through the
 * Overpass API) as a POI source. Owns the config-schema fragment for the
 * enable toggle, the Overpass endpoint URL, and the seamark feature groups to
 * import. Unlike the ActiveCaptain input, it is opt-in: `isEnabled` follows
 * the `openSeaMapEnabled` toggle, which defaults off.
 */

import { createOverpassClient } from './overpass-client.js'
import { createOpenSeaMapSource, OPENSEAMAP_SOURCE_ID } from './openseamap-source.js'
import { DEFAULT_DEDUPE_RADIUS_METERS } from '../dedupe-pois.js'
import type { InputContext, InputModule } from '../poi-source.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import type { PluginConfig } from '../../shared/types.js'
import {
  clampMinimumYear,
  DEFAULT_MINIMUM_YEAR,
  MAX_YEAR,
  MIN_YEAR
} from '../../shared/year-filter.js'

/** Default Overpass interpreter URL when configuration omits one. */
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter'

/**
 * Default and bounds for the per-bbox debounce window. Matches the NOAA ENC
 * defaults so the two at-runtime sources behave the same way out of the box.
 */
const DEFAULT_REFRESH_SECONDS = 30
const MIN_REFRESH_SECONDS = 0
const MAX_REFRESH_SECONDS = 600

/** The enable, endpoint, seamark-group, dedupe, and radius config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  openSeaMapEnabled: {
    type: 'boolean',
    title: 'Import points of interest from OpenSeaMap (OpenStreetMap marine data)',
    default: false
  },
  openSeaMapEndpoint: {
    type: 'string',
    title: 'Overpass API endpoint URL',
    default: DEFAULT_ENDPOINT
  },
  openSeaMapSeamarkGroups: {
    type: 'array',
    title: 'OpenSeaMap feature groups to import',
    items: { type: 'string', enum: [...SEAMARK_GROUP_IDS] },
    default: [...SEAMARK_GROUP_IDS]
  },
  openSeaMapDedupe: {
    type: 'boolean',
    title: 'Merge OpenSeaMap points of interest that duplicate an ActiveCaptain marker',
    default: true
  },
  openSeaMapDedupeRadiusMeters: {
    type: 'number',
    title: 'Merge radius for OpenSeaMap points of interest, in meters',
    default: DEFAULT_DEDUPE_RADIUS_METERS,
    minimum: 1
  },
  openSeaMapMinimumYear: {
    type: 'number',
    title: 'Earliest OpenSeaMap update year (0 to import every element)',
    default: DEFAULT_MINIMUM_YEAR,
    minimum: MIN_YEAR,
    maximum: MAX_YEAR
  },
  openSeaMapRefreshSeconds: {
    type: 'number',
    title: 'OpenSeaMap bbox-debounce window, in seconds (0 to query Overpass on every list call)',
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

/** Resolve the Overpass endpoint from raw config, applying the default. */
function resolveEndpoint (raw: unknown): string {
  if (typeof raw !== 'string') {
    return DEFAULT_ENDPOINT
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_ENDPOINT
}

/** Resolve the seamark groups from raw config, applying the all-groups default. */
function resolveSeamarkGroups (raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...SEAMARK_GROUP_IDS]
  }
  return raw.filter((group): group is string => typeof group === 'string')
}

/** The OpenSeaMap input module. */
export const openSeaMapInput: InputModule = {
  id: OPENSEAMAP_SOURCE_ID,
  name: 'OpenSeaMap',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.openSeaMapEnabled === true,
  // Dedupe defaults on: an absent toggle still merges OpenSeaMap duplicates of
  // an ActiveCaptain marker. Only an explicit false turns it off.
  isDedupeEnabled: (config: PluginConfig) => config.openSeaMapDedupe !== false,
  createSource: (context: InputContext) => {
    const { app, config, status } = context
    return createOpenSeaMapSource({
      client: createOverpassClient(resolveEndpoint(config.openSeaMapEndpoint), app),
      seamarkGroups: resolveSeamarkGroups(config.openSeaMapSeamarkGroups),
      minimumYear: clampMinimumYear(config.openSeaMapMinimumYear),
      refreshSeconds: resolveRefreshSeconds(config.openSeaMapRefreshSeconds),
      status
    })
  }
}
