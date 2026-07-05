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
import {
  clampBboxDebounceSeconds,
  DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS,
  refreshSecondsSchema
} from '../../shared/bbox-debounce-bounds.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import { OPENSEAMAP_SOURCE_ID } from '../../shared/source-ids.js'
import type { PluginConfig } from '../../shared/types.js'
import { clampMinimumYear, minimumYearSchema } from '../../shared/year-filter.js'
import {
  DEFAULT_OVERPASS_ENDPOINT,
  RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS,
  normalizeFallbackEndpoints,
  resolvePrimaryEndpoint
} from '../../shared/overpass-endpoints.js'

/** The enable, endpoint, fallback, seamark-group, dedupe, and radius config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  openSeaMapEnabled: {
    type: 'boolean',
    title: 'Import points of interest from OpenSeaMap (OpenStreetMap marine data)',
    default: false
  },
  openSeaMapEndpoint: {
    type: 'string',
    title: 'Overpass API endpoint URL',
    default: DEFAULT_OVERPASS_ENDPOINT
  },
  openSeaMapFallbackEndpoints: {
    type: 'array',
    title: 'Overpass fallback endpoints (tried in order when the primary fails)',
    description:
      'Optional mirror endpoints the OpenSeaMap source fails over to when the ' +
      'primary Overpass endpoint is unreachable. Leave empty to use only the ' +
      'primary. Suggested full-planet mirrors: ' +
      RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS.join(', ') +
      '. Avoid regional extracts such as overpass.osm.ch, which answer with no ' +
      'data outside their region.',
    items: { type: 'string' },
    default: []
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
    'OpenSeaMap bbox-debounce window, in seconds (0 to query Overpass on every list call)',
    DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS
  )
}

/**
 * Resolve the ordered Overpass endpoint list from config: the primary endpoint
 * first, then any configured fallback mirrors, with blanks and duplicates (and
 * any fallback equal to the primary) removed. The dedupe is delegated to the
 * shared {@link normalizeFallbackEndpoints} so the rule lives in one place. The
 * client tries the endpoints in order, failing over on each failure. Exported
 * for unit testing.
 */
export function resolveEndpoints (config: PluginConfig): string[] {
  const primary = resolvePrimaryEndpoint(config.openSeaMapEndpoint)
  const fallbacks = normalizeFallbackEndpoints(config.openSeaMapFallbackEndpoints)
  return normalizeFallbackEndpoints([primary, ...fallbacks])
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
    cappedDedupeRadius(config.openSeaMapDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { app, config, status, dataDir } = context
    return createOpenSeaMapSource({
      client: createOverpassClient(resolveEndpoints(config), app),
      seamarkGroups: resolveSeamarkGroups(config.openSeaMapSeamarkGroups),
      minimumYear: clampMinimumYear(config.openSeaMapMinimumYear),
      refreshSeconds: clampBboxDebounceSeconds(
        config.openSeaMapRefreshSeconds, DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS
      ),
      status,
      dataDir
    })
  }
}
