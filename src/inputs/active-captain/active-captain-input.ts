/**
 * ActiveCaptain input module.
 *
 * Registers the ActiveCaptain API as a POI source. Owns the config-schema
 * fragment for the cache duration and the 13 POI-type toggles, since those
 * tune the ActiveCaptain API specifically. Always enabled: it is the plugin's
 * only data source. The POI-type toggles control which types are fetched, not
 * whether the source runs.
 */

import { createActiveCaptainClient } from './active-captain-client.js'
import { createActiveCaptainSource, ACTIVE_CAPTAIN_SOURCE_ID } from './active-captain-source.js'
import type { InputContext, InputModule } from '../poi-source.js'

/** Default caching window, in minutes, when configuration omits it. */
const DEFAULT_CACHING_DURATION_MINUTES = 60

/** The cache-duration and POI-type-toggle config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  cachingDurationMinutes: {
    type: 'number',
    title: 'How long to cache data from Active Captain in minutes (longer = less data traffic; shorter = more up to date data)',
    default: DEFAULT_CACHING_DURATION_MINUTES
  },
  includeMarinas: { type: 'boolean', title: 'Include marinas', default: true },
  includeAnchorages: { type: 'boolean', title: 'Include anchorages', default: true },
  includeHazards: { type: 'boolean', title: 'Include hazards', default: true },
  includeBusinesses: { type: 'boolean', title: 'Include businesses', default: true },
  includeBoatRamps: { type: 'boolean', title: 'Include boat ramps', default: true },
  includeBridges: { type: 'boolean', title: 'Include bridges', default: true },
  includeDams: { type: 'boolean', title: 'Include dams', default: true },
  includeFerries: { type: 'boolean', title: 'Include ferries', default: true },
  includeInlets: { type: 'boolean', title: 'Include inlets', default: true },
  includeLocks: { type: 'boolean', title: 'Include locks', default: true },
  includeLocalKnowledge: { type: 'boolean', title: 'Include local knowledge', default: true },
  includeNavigational: { type: 'boolean', title: 'Include navigational aids', default: true },
  includeAirports: { type: 'boolean', title: 'Include airports', default: true }
}

/** Resolve the caching duration from raw config, applying the default. */
function resolveCachingDuration (raw: unknown): number {
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_CACHING_DURATION_MINUTES
}

/** The ActiveCaptain input module. */
export const activeCaptainInput: InputModule = {
  id: ACTIVE_CAPTAIN_SOURCE_ID,
  name: 'Garmin ActiveCaptain',
  configSchema: CONFIG_SCHEMA,
  isEnabled: () => true,
  createSource: (context: InputContext) => {
    const { app, config, status, dataDir } = context
    return createActiveCaptainSource({
      client: createActiveCaptainClient(app),
      cachingDurationMinutes: resolveCachingDuration(config.cachingDurationMinutes),
      dataDir,
      status,
      app
    })
  }
}
