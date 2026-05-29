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
import { createOpenSeaMapSource } from './openseamap-source.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'
import type { InputContext, InputModule } from '../poi-source.js'
import { clampBboxDebounceSeconds, refreshSecondsSchema } from '../../shared/bbox-debounce.js'
import { positiveFiniteNumber } from '../../shared/numbers.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import { OPENSEAMAP_SOURCE_ID } from '../../shared/source-ids.js'
import type { PluginConfig } from '../../shared/types.js'
import { clampMinimumYear, minimumYearSchema } from '../../shared/year-filter.js'

/** Default Overpass interpreter URL when configuration omits one. */
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter'

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
  openSeaMapDedupe: dedupeToggleSchema(
    'Merge OpenSeaMap points of interest that duplicate an ActiveCaptain marker'
  ),
  openSeaMapDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for OpenSeaMap points of interest, in meters'
  ),
  openSeaMapMinimumYear: minimumYearSchema(
    'Earliest OpenSeaMap update year (0 to import every element)'
  ),
  openSeaMapRefreshSeconds: refreshSecondsSchema(
    'OpenSeaMap bbox-debounce window, in seconds (0 to query Overpass on every list call)'
  )
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
  // Per-source merge radius surfaced on the OpenSeaMap card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    positiveFiniteNumber(config.openSeaMapDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { app, config, status } = context
    return createOpenSeaMapSource({
      client: createOverpassClient(resolveEndpoint(config.openSeaMapEndpoint), app),
      seamarkGroups: resolveSeamarkGroups(config.openSeaMapSeamarkGroups),
      minimumYear: clampMinimumYear(config.openSeaMapMinimumYear),
      refreshSeconds: clampBboxDebounceSeconds(config.openSeaMapRefreshSeconds),
      status
    })
  }
}
