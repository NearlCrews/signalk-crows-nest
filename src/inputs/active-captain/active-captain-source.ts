/**
 * ActiveCaptain POI source.
 *
 * Wires the ActiveCaptain HTTP client, the TTL detail cache, and the on-disk
 * store into one `PoiSource`. The cache listener records detail outcomes onto
 * the status recorder; a 404 is the API answering normally (the point of
 * interest does not exist), so it is recorded as a success, not an outage.
 *
 * `listPointsOfInterest` applies the minimum-rating filter to this source's
 * own results, so the threshold gates only ActiveCaptain POIs, the only ones
 * that carry a review score.
 *
 * Once `close()` has run, the source is torn down: a load that resolves after
 * close belongs to the stopped run, so its outcome is neither recorded onto a
 * later run's status nor persisted to the on-disk store.
 */

import type { ServerAPI } from '@signalk/server-api'
import { HttpError } from './active-captain-client.js'
import type { ActiveCaptainClient } from './active-captain-client.js'
import { createPoiCache } from './poi-cache.js'
import { createPoiStore } from './poi-store.js'
import type { PoiStore } from './poi-store.js'
import { parseApiDate, renderDescription } from './poi-detail-renderer.js'
import { filterByRating } from './rating-filter.js'
import type { PoiSource } from '../poi-source.js'
import type { PoiDetailView } from '../../shared/types.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** The stable id of the ActiveCaptain source. */
export const ACTIVE_CAPTAIN_SOURCE_ID = 'activecaptain'

/** Human-readable attribution credit for ActiveCaptain data. */
const ACTIVE_CAPTAIN_ATTRIBUTION = 'Data from Garmin ActiveCaptain'

/** Public ActiveCaptain page for a point of interest, by id. */
const POI_PAGE_URL_PREFIX = 'https://activecaptain.garmin.com/en-US/pois/'

/** HTTP status for a point of interest that does not exist. */
const HTTP_NOT_FOUND = 404

/** Dependencies for {@link createActiveCaptainSource}. */
export interface ActiveCaptainSourceConfig {
  /** The ActiveCaptain HTTP client. */
  client: ActiveCaptainClient
  /** Detail cache TTL, in minutes. */
  cachingDurationMinutes: number
  /**
   * Lowest average rating (0 to 5) a ratable POI must reach to be listed.
   * Omitted or 0 lists every point of interest.
   */
  minimumRating?: number
  /** Plugin data directory, for the on-disk store. */
  dataDir: string
  /** Status recorder for detail outcomes. */
  status: PluginStatus
  /** SignalK app, for `setPluginError` and `debug`. */
  app: Pick<ServerAPI, 'setPluginError' | 'debug'>
}

/** Create the ActiveCaptain POI source. */
export function createActiveCaptainSource (config: ActiveCaptainSourceConfig): PoiSource {
  const { client, cachingDurationMinutes, dataDir, status, app, minimumRating = 0 } = config

  // Set by close(). Once the source is closed, a load that resolves later
  // belongs to the torn-down run: its outcome must not touch a later run's
  // status, nor the on-disk store.
  let closed = false

  const baseStore = createPoiStore(dataDir, cachingDurationMinutes)
  // Wrap the store so a load that resolves after close() does not write to
  // disk: that run is gone, and the entry would only mislead a later cold
  // start drawn from a partially torn-down run.
  const store: PoiStore = {
    load: () => baseStore.load(),
    persist: (id, details) => {
      if (!closed) {
        baseStore.persist(id, details)
      }
    },
    clear: () => { baseStore.clear() }
  }

  const cache = createPoiCache(client, cachingDurationMinutes, {
    onLoadSuccess: () => {
      // A load that resolves after close belongs to the stopped run; do not
      // record it onto a later run's status.
      if (!closed) {
        status.recordDetailSuccess(ACTIVE_CAPTAIN_SOURCE_ID)
      }
    },
    onLoadError: (error) => {
      // Once closed, a late-resolving load belongs to the torn-down run: drop
      // its outcome rather than recording it onto a later run's status. This
      // also covers the benign AbortError raised when close() aborts the
      // previous run's in-flight detail fetches. A genuine abort that is NOT
      // from the plugin's own close() leaves `closed` false, so it falls
      // through and is recorded as the real failure it is.
      if (closed) {
        return
      }
      // A 404 is the API answering normally: the point of interest does not
      // exist. That is not a reachability failure.
      if (error instanceof HttpError && error.status === HTTP_NOT_FOUND) {
        status.recordDetailSuccess(ACTIVE_CAPTAIN_SOURCE_ID)
      } else {
        const message = `Detail request failed: ${String(error)}`
        status.recordError(ACTIVE_CAPTAIN_SOURCE_ID, message)
        app.setPluginError(message)
      }
    }
  }, store)

  return {
    id: ACTIVE_CAPTAIN_SOURCE_ID,
    listPointsOfInterest: async (bbox, poiTypes) => {
      const summaries = await client.listPointsOfInterest(bbox, poiTypes)
      // The client is source-agnostic; tag each summary with the source slug,
      // its public ActiveCaptain page, and the attribution credit.
      const tagged = summaries.map((summary) => ({
        ...summary,
        source: ACTIVE_CAPTAIN_SOURCE_ID,
        url: `${POI_PAGE_URL_PREFIX}${summary.id}`,
        attribution: ACTIVE_CAPTAIN_ATTRIBUTION
      }))
      // The minimum-rating filter gates ratable POIs on the review score
      // ActiveCaptain supplies. It runs here, on this source's own results, so
      // it never touches POIs from sources that carry no rating.
      return filterByRating(tagged, minimumRating)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const entity = await cache.get(id)
      const poi = entity.pointOfInterest
      let description: string | undefined
      try {
        // The rendered template ends with a footer partial that already
        // credits ActiveCaptain, so the description needs no extra
        // attribution line appended.
        description = renderDescription(entity)
      } catch (error) {
        app.debug(`Unable to format description for ${id}: ${String(error)}`)
      }
      const modified = parseApiDate(poi.dateLastModified)
      return {
        name: poi.name,
        position: { ...poi.mapLocation },
        type: poi.poiType,
        url: `${POI_PAGE_URL_PREFIX}${id}`,
        source: ACTIVE_CAPTAIN_SOURCE_ID,
        attribution: ACTIVE_CAPTAIN_ATTRIBUTION,
        ...(description !== undefined && { description }),
        ...(Number.isFinite(modified.getTime()) && { timestamp: modified.toISOString() })
      }
    },
    cacheSize: () => cache.size(),
    close: () => {
      closed = true
      client.close()
    }
  }
}
