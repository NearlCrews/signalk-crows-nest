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
import { SEAMARK_GROUPS } from './seamark-mapping.js'
import type { InputContext, InputModule } from '../poi-source.js'
import type { PluginConfig } from '../../shared/types.js'

/** Default Overpass interpreter URL when configuration omits one. */
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter'

/** Every seamark group id, the default selection and the only valid values. */
const ALL_GROUP_IDS = SEAMARK_GROUPS.map((group) => group.id)

/** The enable, endpoint, and seamark-group config fragment. */
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
    items: { type: 'string', enum: ['hazards', 'navaids', 'harbours', 'infrastructure'] },
    default: ['hazards', 'navaids', 'harbours', 'infrastructure']
  }
}

/** Resolve the Overpass endpoint from raw config, applying the default. */
function resolveEndpoint (raw: unknown): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : DEFAULT_ENDPOINT
}

/** Resolve the seamark groups from raw config, applying the all-groups default. */
function resolveSeamarkGroups (raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...ALL_GROUP_IDS]
  }
  return raw.filter((group): group is string => typeof group === 'string')
}

/** The OpenSeaMap input module. */
export const openSeaMapInput: InputModule = {
  id: OPENSEAMAP_SOURCE_ID,
  name: 'OpenSeaMap',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.openSeaMapEnabled === true,
  createSource: (context: InputContext) => {
    const { app, config } = context
    return createOpenSeaMapSource({
      client: createOverpassClient(resolveEndpoint(config.openSeaMapEndpoint), app),
      seamarkGroups: resolveSeamarkGroups(config.openSeaMapSeamarkGroups)
    })
  }
}
