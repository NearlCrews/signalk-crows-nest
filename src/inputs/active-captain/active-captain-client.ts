/**
 * HTTP client for the ActiveCaptain community API.
 *
 * Builds list and detail requests against the community API and normalizes the
 * responses. Concurrency, throttling, retry/backoff, Retry-After honoring, and
 * close() all live in the shared HTTP client (see `../http-client.js`); this
 * module owns only the ActiveCaptain-specific URL, headers, request body, and
 * response shape.
 *
 * Error contract: both client methods REJECT on failure. Neither method ever
 * resolves with undefined. Rejections are handled by the callers:
 * active-captain-source.ts records list outcomes, and poi-cache.ts routes
 * detail outcomes to the source's cache listener.
 */

import { assertResponseOk, createHttpClient, type RateLimitOptions, type Sleep } from '../http-client.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import type { Bbox, PoiSummary, Logger } from '../../shared/types.js'
import type { PoiDetails, PoiListResponse } from './active-captain-types.js'

export { HttpError } from '../http-client.js'
export type { RateLimitOptions, Sleep } from '../http-client.js'

/**
 * A list entry as produced by the client. It carries every `PoiSummary` field
 * except the source-identity fields (`source`, `url`, `attribution`, and the
 * Freeboard `skIcon`): the client has no notion of the source slug or its icon
 * mapping, so the source adapter tags those on.
 */
export type ClientPoiSummary = Omit<PoiSummary, 'source' | 'url' | 'attribution' | 'skIcon'>

const BASE_URL = 'https://activecaptain.garmin.com'

/** Headers sent on every request to the ActiveCaptain API. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': PLUGIN_USER_AGENT,
  Accept: 'application/json'
}

/** Zoom level sent with bounding-box queries; the API expects an integer. */
const ZOOM_LEVEL = 17

/** Per-request HTTP timeout, in milliseconds. */
const REQUEST_TIMEOUT_MS = 10000

/**
 * Rate-limiting defaults.
 *
 * These values come from the ActiveCaptain API research in docs/garmin-api.md
 * (section 3.3). The community API publishes no rate limit and showed no
 * throttling under probing, but it is Cloudflare-fronted, so the client stays
 * a good citizen: a modest concurrency cap, ~5 requests per second steady
 * state, and exponential backoff with full jitter.
 */
const DEFAULTS: RateLimitOptions = {
  maxConcurrency: 5,
  minDelayMs: 200,
  backoffBaseMs: 1000,
  maxBackoffMs: 30000,
  maxRetries: 4,
  // 5 min ceiling on a server-supplied Retry-After: ample for a Garmin
  // cooldown, capped against a misbehaving edge.
  maxRetryAfterMs: 300_000
}

/** Public surface of the ActiveCaptain client. */
export interface ActiveCaptainClient {
  /**
   * List points of interest within a bounding box.
   * Resolves with a normalized array (possibly empty). Rejects on any HTTP,
   * network, or parsing failure.
   */
  listPointsOfInterest: (bbox: Bbox, poiTypes: string) => Promise<ClientPoiSummary[]>
  /**
   * Fetch the full detail summary for a single point of interest.
   * Rejects on any HTTP, network, or parsing failure.
   */
  pointOfInterestDetails: (id: string) => Promise<PoiDetails>
  /**
   * Abort any in-flight requests and stop retrying. Call this from
   * plugin.stop so a late response cannot record onto a later run's state.
   */
  close: () => void
}

/**
 * Create an ActiveCaptain client.
 *
 * @param log     Logging surface used for diagnostics.
 * @param options Optional rate-limit overrides. Mainly used by tests to keep
 *                them fast; production callers can pass just the logger.
 * @param sleep   Optional sleep-injection so tests can capture the requested
 *                Retry-After wait without paying it on the wall clock.
 *                Production callers pass nothing.
 */
export function createActiveCaptainClient (
  log: Logger,
  options: Partial<RateLimitOptions> = {},
  sleep?: Sleep
): ActiveCaptainClient {
  const http = createHttpClient(log, {
    label: 'ActiveCaptain',
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    defaults: DEFAULTS
  }, options, sleep)

  async function listPointsOfInterest (bbox: Bbox, poiTypes: string): Promise<ClientPoiSummary[]> {
    const url = `${BASE_URL}/community/api/v1/points-of-interest/bbox`
    try {
      const response = await http.fetch(url, {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          north: bbox.north,
          west: bbox.west,
          south: bbox.south,
          east: bbox.east,
          zoomLevel: ZOOM_LEVEL,
          poiTypes
        })
      })

      await assertResponseOk(response, 'ActiveCaptain list request failed')

      const data = await response.json() as PoiListResponse
      if (!Array.isArray(data?.pointsOfInterest)) {
        throw new Error('ActiveCaptain list response missing pointsOfInterest array')
      }

      // Keep only individually addressable points of interest. Malformed
      // entries are dropped so one bad element cannot fail the whole search.
      // Cluster entries (poiCount > 1) are also dropped: they carry a synthetic
      // id with no name, and getResource on that id returns HTTP 404.
      const usable = data.pointsOfInterest.filter(poi =>
        poi != null &&
        poi.id != null &&
        poi.poiType != null &&
        typeof poi.name === 'string' && poi.name.length > 0 &&
        (poi.poiCount ?? 1) <= 1 &&
        poi.mapLocation != null &&
        isValidLatitude(poi.mapLocation.latitude) &&
        isValidLongitude(poi.mapLocation.longitude)
      )
      const skipped = data.pointsOfInterest.length - usable.length
      if (skipped > 0) {
        log.debug(`Skipped ${skipped} cluster or malformed point(s) of interest in the list response`)
      }

      return usable.map(poi => {
        const summary: ClientPoiSummary = {
          // The API returns numeric POI ids; coerce so PoiSummary.id is
          // genuinely a string and a later .replace() in the alarm code
          // cannot throw on a number.
          id: String(poi.id),
          type: poi.poiType,
          position: {
            longitude: poi.mapLocation.longitude,
            latitude: poi.mapLocation.latitude
          },
          name: poi.name
        }
        // Carry the review score through ONLY when the wire actually
        // carries reviews. The AC API sometimes returns
        // `reviewSummary: { averageRating: 0, numberOfReviews: 0 }`
        // for a ratable point of interest that has not been reviewed
        // yet; that "0/5" is a placeholder, not a real rating, and
        // would otherwise (a) be hidden by the minimum-rating filter
        // exactly like an actual 0-star marina, surprising the user,
        // and (b) be rendered as "0/5 ⭐ from (0 reviews)" in the
        // popup, which is meaningless data. Treat it as "unrated":
        // leave both fields off the summary, so the filter drops it
        // when the user wants quality-only AND the popup omits the
        // rating section entirely.
        const reviewSummary = poi.reviewSummary
        if (reviewSummary != null && reviewSummary.numberOfReviews > 0) {
          summary.rating = reviewSummary.averageRating
          summary.reviewCount = reviewSummary.numberOfReviews
        }
        return summary
      })
    } catch (error) {
      log.debug(`ERROR fetching points of interest list ${JSON.stringify(bbox)} - ${String(error)}`)
      throw error
    }
  }

  async function pointOfInterestDetails (id: string): Promise<PoiDetails> {
    const url = `${BASE_URL}/community/api/v1/points-of-interest/${id}/summary`
    try {
      const response = await http.fetch(url, {
        method: 'GET',
        headers: { ...BASE_HEADERS }
      })

      await assertResponseOk(response, `ActiveCaptain details request failed for ${id}`)

      const data = await response.json() as PoiDetails
      const poi = data?.pointOfInterest
      if (
        poi?.poiType == null ||
        poi.mapLocation == null ||
        typeof poi.name !== 'string' ||
        poi.name.length === 0
      ) {
        throw new Error(
          `ActiveCaptain details response for ${id} is missing required point-of-interest fields`
        )
      }

      return data
    } catch (error) {
      log.debug(`ERROR fetching point of interest ${id} - ${String(error)}`)
      throw error
    }
  }

  return {
    listPointsOfInterest,
    pointOfInterestDetails,
    close: () => { http.close() }
  }
}
