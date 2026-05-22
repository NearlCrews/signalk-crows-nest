/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * HTTP client for the ActiveCaptain community API.
 *
 * This module replaces the old axios-based client. It uses the native global
 * fetch (Node 20+), applies client-side rate limiting (concurrency cap, request
 * throttle, retry with backoff that respects HTTP 429 and the Retry-After
 * header), and exposes a small factory.
 *
 * Error contract: both client methods REJECT on failure. Neither method ever
 * resolves with undefined. The old client swallowed errors in a .catch and
 * returned undefined, which crashed callers that ran .map on the result. The
 * caller (index.ts) is responsible for handling rejections.
 */

import type { Bbox, PoiDetails, PoiListResponse, PoiSummary, Logger } from './types.js'

const BASE_URL = 'https://activecaptain.garmin.com'
const USER_AGENT = 'Signal K Active Captain Plugin'

/** Headers sent on every request to the ActiveCaptain API. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json'
}

/** Zoom level sent with bounding-box queries, matching the legacy client. */
const ZOOM_LEVEL = 17

/** Per-request timeout. A hung request frees its slot once this elapses. */
const REQUEST_TIMEOUT_MS = 10000

/**
 * Rate-limiting defaults.
 *
 * These values come from the ActiveCaptain API research in docs/garmin-api.md
 * (section 3.3). The community API publishes no rate limit and showed no
 * throttling under probing, but it is Cloudflare-fronted, so the client stays a
 * good citizen: a modest concurrency cap, ~5 requests per second steady state,
 * and exponential backoff with full jitter.
 */
const DEFAULT_MAX_CONCURRENCY = 5
const DEFAULT_MIN_DELAY_MS = 200
const DEFAULT_BACKOFF_BASE_MS = 1000
const DEFAULT_MAX_BACKOFF_MS = 30000
const DEFAULT_MAX_RETRIES = 4

/** HTTP status that signals the caller is being rate limited. */
const HTTP_TOO_MANY_REQUESTS = 429

/** HTTP status for an upstream gateway error. */
const HTTP_BAD_GATEWAY = 502

/** HTTP status for a temporarily unavailable service. */
const HTTP_SERVICE_UNAVAILABLE = 503

/** HTTP status for an upstream gateway timeout. */
const HTTP_GATEWAY_TIMEOUT = 504

/**
 * HTTP statuses worth retrying: rate limiting and transient gateway errors.
 * Other 4xx responses (notably 404, a POI that does not exist) are permanent
 * and are never retried.
 */
const RETRYABLE_STATUSES = new Set<number>([
  HTTP_TOO_MANY_REQUESTS, HTTP_BAD_GATEWAY, HTTP_SERVICE_UNAVAILABLE, HTTP_GATEWAY_TIMEOUT
])

/** Tunable rate-limit knobs. All optional; defaults above are used when omitted. */
export interface RateLimitOptions {
  /** Maximum number of in-flight requests at once. */
  maxConcurrency: number
  /** Minimum spacing, in milliseconds, between request starts. */
  minDelayMs: number
  /** Base delay for exponential backoff, in milliseconds. */
  backoffBaseMs: number
  /** Upper bound for a single backoff wait, in milliseconds. */
  maxBackoffMs: number
  /** Maximum retry attempts after the first try, for 429, 502, 503, and 504 responses. */
  maxRetries: number
}

/** Public surface of the ActiveCaptain client. */
export interface ActiveCaptainClient {
  /**
   * List points of interest within a bounding box.
   * Resolves with a normalised array (possibly empty). Rejects on any HTTP,
   * network, or parsing failure.
   */
  listPointsOfInterest: (bbox: Bbox, poiTypes: string) => Promise<PoiSummary[]>
  /**
   * Fetch the full detail summary for a single point of interest.
   * Rejects on any HTTP, network, or parsing failure.
   */
  pointOfInterestDetails: (id: string) => Promise<PoiDetails>
}

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * A concurrency-limited, throttled task queue. It caps the number of in-flight
 * tasks and enforces a minimum spacing between task starts.
 */
class RequestQueue {
  private active = 0
  private nextAllowedStart = 0
  private readonly waiting: Array<() => void> = []

  constructor (
    private readonly maxConcurrency: number,
    private readonly minDelayMs: number
  ) {}

  async run<T> (task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire (): Promise<void> {
    return new Promise(resolve => {
      this.waiting.push(resolve)
      this.pump()
    })
  }

  private pump (): void {
    if (this.active >= this.maxConcurrency) {
      return
    }
    const next = this.waiting.shift()
    if (next === undefined) {
      return
    }
    this.active++
    const now = Date.now()
    const wait = Math.max(0, this.nextAllowedStart - now)
    this.nextAllowedStart = now + wait + this.minDelayMs
    setTimeout(next, wait)
  }

  private release (): void {
    this.active--
    this.pump()
  }
}

/**
 * Parse a Retry-After header into a millisecond delay. The header may be either
 * an integer count of seconds or an HTTP date. Returns undefined when absent or
 * unparseable.
 */
function parseRetryAfter (headerValue: string | null): number | undefined {
  if (headerValue == null || headerValue.trim() === '') {
    return undefined
  }
  const seconds = Number(headerValue)
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }
  const dateMs = Date.parse(headerValue)
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now())
  }
  return undefined
}

/** Exponential backoff with full jitter for the given zero-based attempt. */
function backoffDelay (attempt: number, baseMs: number, maxMs: number): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.random() * ceiling
}

/**
 * Error thrown when the ActiveCaptain API returns a non-ok HTTP response. The
 * `status` lets callers tell a transient failure from a permanent one, for
 * example a 404 for a point of interest that no longer exists.
 */
export class HttpError extends Error {
  readonly status: number

  constructor (message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Reject when a response is not ok, releasing its socket first since the body
 * of a failed response is never read. `errorPrefix` is suffixed with the HTTP
 * status and status text.
 */
async function assertResponseOk (response: Response, errorPrefix: string): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(`${errorPrefix}: ${response.status} ${response.statusText}`, response.status)
  }
}

/**
 * Create an ActiveCaptain client.
 *
 * @param log     Logging surface used for diagnostics.
 * @param options Optional rate-limit overrides. Mainly used by tests to keep
 *                them fast; production callers can pass just the logger.
 */
export function createActiveCaptainClient (
  log: Logger,
  options: Partial<RateLimitOptions> = {}
): ActiveCaptainClient {
  const limits: RateLimitOptions = {
    maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    minDelayMs: options.minDelayMs ?? DEFAULT_MIN_DELAY_MS,
    backoffBaseMs: options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES
  }

  const queue = new RequestQueue(limits.maxConcurrency, limits.minDelayMs)

  /**
   * Perform a single fetch with retry/backoff. Retries network errors and
   * retryable HTTP statuses (429, 502, 503, 504). A 429 or 503 honours the
   * Retry-After header when present. The body of a discarded retryable
   * response is cancelled so its socket is released promptly. Resolves with
   * the final Response; non-ok handling is left to the caller.
   */
  async function fetchWithRetry (url: string, init: RequestInit): Promise<Response> {
    let attempt = 0
    for (;;) {
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })

        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= limits.maxRetries) {
          return response
        }

        const honoursRetryAfter =
          response.status === HTTP_TOO_MANY_REQUESTS ||
          response.status === HTTP_SERVICE_UNAVAILABLE
        const retryAfter = honoursRetryAfter
          ? parseRetryAfter(response.headers.get('retry-after'))
          : undefined
        // A Retry-After header is honoured but still capped: an upstream (or a
        // misbehaving edge) sending a huge value must not stall the request,
        // and its queue slot, for minutes or longer.
        const wait = Math.min(
          retryAfter ?? backoffDelay(attempt, limits.backoffBaseMs, limits.maxBackoffMs),
          limits.maxBackoffMs
        )
        log.debug(
          `ActiveCaptain request to ${url} returned ${response.status}, ` +
          `retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${limits.maxRetries})`
        )
        // Release the socket: the retried response body is never read.
        await response.body?.cancel()
        await delay(wait)
        attempt++
      } catch (error) {
        if (attempt >= limits.maxRetries) {
          throw error
        }
        const wait = backoffDelay(attempt, limits.backoffBaseMs, limits.maxBackoffMs)
        log.debug(
          `ActiveCaptain request to ${url} failed (${String(error)}), ` +
          `retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${limits.maxRetries})`
        )
        await delay(wait)
        attempt++
      }
    }
  }

  async function listPointsOfInterest (bbox: Bbox, poiTypes: string): Promise<PoiSummary[]> {
    const url = `${BASE_URL}/community/api/v1/points-of-interest/bbox`
    try {
      const response = await queue.run(() => fetchWithRetry(url, {
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
      }))

      await assertResponseOk(response, 'ActiveCaptain list request failed')

      const data = await response.json() as PoiListResponse
      if (!Array.isArray(data?.pointsOfInterest)) {
        throw new Error('ActiveCaptain list response missing pointsOfInterest array')
      }

      // Drop any malformed entry rather than letting one bad element throw and
      // fail the whole search area.
      const usable = data.pointsOfInterest.filter(poi =>
        poi != null &&
        poi.id != null &&
        poi.poiType != null &&
        poi.mapLocation != null &&
        Number.isFinite(poi.mapLocation.latitude) &&
        Number.isFinite(poi.mapLocation.longitude)
      )
      const skipped = data.pointsOfInterest.length - usable.length
      if (skipped > 0) {
        log.debug(`Skipped ${skipped} malformed point(s) of interest in the list response`)
      }

      return usable.map(poi => ({
        id: poi.id,
        type: poi.poiType,
        position: {
          longitude: poi.mapLocation.longitude,
          latitude: poi.mapLocation.latitude
        },
        name: poi.name
      }))
    } catch (error) {
      log.debug(`ERROR fetching points of interest list ${JSON.stringify(bbox)} - ${String(error)}`)
      throw error
    }
  }

  async function pointOfInterestDetails (id: string): Promise<PoiDetails> {
    const url = `${BASE_URL}/community/api/v1/points-of-interest/${id}/summary`
    try {
      const response = await queue.run(() => fetchWithRetry(url, {
        method: 'GET',
        headers: { ...BASE_HEADERS }
      }))

      await assertResponseOk(response, `ActiveCaptain details request failed for ${id}`)

      const data = await response.json() as PoiDetails
      const poi = data?.pointOfInterest
      if (poi?.poiType == null || poi.mapLocation == null) {
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

  return { listPointsOfInterest, pointOfInterestDetails }
}
