/**
 * ActiveCaptain input module.
 *
 * Registers the ActiveCaptain API as a POI source. Owns the config-schema
 * fragment for the cache duration, the minimum-rating filter, and the 13
 * POI-type toggles, since those tune the ActiveCaptain API specifically.
 * Always enabled: the POI-type toggles control which types are fetched, not
 * whether the source runs.
 */

import { createActiveCaptainClient } from './active-captain-client.js'
import { createActiveCaptainSource } from './active-captain-source.js'
import type { InputContext, InputModule } from '../poi-source.js'
import {
  clampBboxDebounceSeconds,
  DEFAULT_BBOX_DEBOUNCE_SECONDS,
  MAX_BBOX_DEBOUNCE_SECONDS,
  MIN_BBOX_DEBOUNCE_SECONDS
} from '../../shared/bbox-debounce.js'
import { ACTIVE_CAPTAIN_SOURCE_ID } from '../../shared/source-ids.js'
import {
  clampMinimumRating,
  DEFAULT_MINIMUM_RATING,
  MAX_RATING,
  MIN_RATING
} from '../../shared/rating.js'

/** Default caching window, in minutes, when configuration omits it. */
const DEFAULT_CACHING_DURATION_MINUTES = 60

/** The cache-duration, minimum-rating, and POI-type-toggle config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  cachingDurationMinutes: {
    type: 'number',
    title: 'How long to cache data from Active Captain in minutes (longer = less data traffic; shorter = more up to date data)',
    default: DEFAULT_CACHING_DURATION_MINUTES
  },
  activeCaptainRefreshSeconds: {
    type: 'number',
    title: 'ActiveCaptain bbox-debounce window, in seconds (0 to query Garmin on every list call)',
    default: DEFAULT_BBOX_DEBOUNCE_SECONDS,
    minimum: MIN_BBOX_DEBOUNCE_SECONDS,
    maximum: MAX_BBOX_DEBOUNCE_SECONDS
  },
  minimumRating: {
    type: 'number',
    title: 'Minimum rating: hide points of interest rated below this (0 to 5; 0 shows all)',
    default: DEFAULT_MINIMUM_RATING,
    minimum: MIN_RATING,
    maximum: MAX_RATING
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
      minimumRating: clampMinimumRating(config.minimumRating),
      refreshSeconds: clampBboxDebounceSeconds(config.activeCaptainRefreshSeconds),
      dataDir,
      status,
      app
    })
  }
}
