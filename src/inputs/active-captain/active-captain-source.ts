/**
 * ActiveCaptain POI source.
 *
 * Wires the ActiveCaptain HTTP client, the TTL detail cache, and the on-disk
 * store into one `PoiSource`. The cache listener records detail outcomes onto
 * the status recorder; a 404 is the API answering normally (the point of
 * interest does not exist), so it is recorded as a success, not an outage.
 */

import type { ServerAPI } from '@signalk/server-api'
import { HttpError } from './active-captain-client.js'
import type { ActiveCaptainClient } from './active-captain-client.js'
import { createPoiCache } from './poi-cache.js'
import { createPoiStore } from './poi-store.js'
import type { PoiSource } from '../poi-source.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** The stable id of the ActiveCaptain source. */
export const ACTIVE_CAPTAIN_SOURCE_ID = 'activecaptain'

/** HTTP status for a point of interest that does not exist. */
const HTTP_NOT_FOUND = 404

/**
 * True when an error is an abort. A `fetch` aborted by `client.close()` rejects
 * with a `DOMException` named `AbortError`; some paths surface a plain `Error`
 * with the same name. Both are matched.
 */
function isAbortError (error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    error.name === 'AbortError'
  )
}

/** Dependencies for {@link createActiveCaptainSource}. */
export interface ActiveCaptainSourceConfig {
  /** The ActiveCaptain HTTP client. */
  client: ActiveCaptainClient
  /** Detail cache TTL, in minutes. */
  cachingDurationMinutes: number
  /** Plugin data directory, for the on-disk store. */
  dataDir: string
  /** Status recorder for detail outcomes. */
  status: PluginStatus
  /** SignalK app, for `setPluginError` and debug logging. */
  app: Pick<ServerAPI, 'setPluginError' | 'debug'>
}

/** Create the ActiveCaptain POI source. */
export function createActiveCaptainSource (config: ActiveCaptainSourceConfig): PoiSource {
  const { client, cachingDurationMinutes, dataDir, status, app } = config

  const store = createPoiStore(dataDir, cachingDurationMinutes)
  const cache = createPoiCache(client, cachingDurationMinutes, {
    onLoadSuccess: () => { status.recordDetailSuccess() },
    onLoadError: (error) => {
      // An abort is benign: a plugin restart calls client.close(), which
      // aborts the previous run's in-flight detail fetches. Recording that as
      // an error would clobber the fresh run's status, so it is ignored.
      if (isAbortError(error)) {
        return
      }
      // A 404 is the API answering normally: the point of interest does not
      // exist. That is not a reachability failure.
      if (error instanceof HttpError && error.status === HTTP_NOT_FOUND) {
        status.recordDetailSuccess()
      } else {
        const message = `Detail request failed: ${String(error)}`
        status.recordError(message)
        app.setPluginError(message)
      }
    }
  }, store)

  return {
    id: ACTIVE_CAPTAIN_SOURCE_ID,
    listPointsOfInterest: (bbox, poiTypes) => client.listPointsOfInterest(bbox, poiTypes),
    getDetails: (id) => cache.get(id),
    cacheSize: () => cache.size(),
    close: () => { client.close() }
  }
}
