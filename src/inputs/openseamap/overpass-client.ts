/**
 * HTTP client for the OpenStreetMap Overpass API.
 *
 * This client mirrors the ActiveCaptain client: it uses the native global
 * fetch and `AbortSignal.any` (Node 20.3+), applies client-side rate limiting
 * (concurrency cap, request throttle, retry with backoff that respects HTTP
 * 429 and the Retry-After header), and exposes a small factory.
 *
 * Overpass differences from the ActiveCaptain client:
 *  - Every request is a POST whose body is an Overpass QL query.
 *  - A descriptive `User-Agent` header is REQUIRED by the Overpass usage
 *    policy and is sent on every request.
 *  - A requested bounding box is clamped to a maximum span, so a wide box
 *    cannot build a query that hits the server's runtime limit. Distant
 *    points of interest are picked up on a later, recentered request.
 *
 * Error contract: both query methods REJECT on any HTTP, network, or parsing
 * failure. `getById` resolves with `undefined` for a query that succeeds but
 * matches no element, which is how a deleted OSM element reads.
 */

import type { Bbox, Logger, Position } from '../../shared/types.js'

/** OSM element types the Overpass API addresses. */
export type OsmElementType = 'node' | 'way' | 'relation'

/**
 * One Overpass element, normalized for the OpenSeaMap source. The Overpass
 * wire element carries `lat`/`lon` for a node and a `center` for a way or a
 * relation; both are resolved here into a single `position`.
 */
export interface OverpassElement {
  /** OSM element type. */
  type: OsmElementType
  /** Numeric OSM element id, unique only within its element type. */
  id: number
  /** OSM tags carried on the element; the source renders detail from these. */
  tags: Record<string, string>
  /** Resolved position. */
  position: Position
}

/** Descriptive User-Agent, required by the Overpass API usage policy. */
const USER_AGENT = 'signalk-crows-nest Signal K plugin'

/** Headers sent on every Overpass request. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': USER_AGENT,
  'Content-Type': 'text/plain',
  Accept: 'application/json'
}

/** Server-side runtime budget, in seconds, for a bounding-box list query. */
const LIST_QUERY_TIMEOUT_SECONDS = 60

/** Server-side runtime budget, in seconds, for a single-element detail query. */
const DETAIL_QUERY_TIMEOUT_SECONDS = 25

/**
 * Per-request HTTP timeout. It sits above the server-side query budget so the
 * client waits for a slow-but-progressing query rather than aborting it.
 */
const REQUEST_TIMEOUT_MS = 70000

/**
 * Maximum span, in degrees, of either edge of a queried bounding box. A wider
 * box is clamped around its center: a single Overpass query stays small enough
 * to finish inside its runtime budget, and distant points of interest are
 * picked up on a later request once the vessel has moved.
 */
const MAX_BBOX_SPAN_DEGREES = 2

/**
 * Rate-limiting defaults. The public Overpass endpoints publish a strict usage
 * policy, so the client stays a conservative citizen: a low concurrency cap, a
 * one-second steady-state spacing, and exponential backoff with full jitter.
 */
const DEFAULT_MAX_CONCURRENCY = 2
const DEFAULT_MIN_DELAY_MS = 1000
const DEFAULT_BACKOFF_BASE_MS = 2000
const DEFAULT_MAX_BACKOFF_MS = 60000
const DEFAULT_MAX_RETRIES = 3

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
 * Other 4xx responses are permanent and are never retried.
 */
const RETRYABLE_STATUSES = new Set<number>([
  HTTP_TOO_MANY_REQUESTS, HTTP_BAD_GATEWAY, HTTP_SERVICE_UNAVAILABLE, HTTP_GATEWAY_TIMEOUT
])

/** Tunable rate-limit knobs. All optional; the defaults above fill the gaps. */
export interface RateLimitOptions {
  /** Maximum number of in-flight requests at once. */
  maxConcurrency: number
  /** Minimum spacing, in milliseconds, between request starts. */
  minDelayMs: number
  /** Base delay for exponential backoff, in milliseconds. */
  backoffBaseMs: number
  /** Upper bound for a single backoff wait, in milliseconds. */
  maxBackoffMs: number
  /** Maximum retry attempts after the first try, for 429, 502, 503, and 504. */
  maxRetries: number
}

/** Public surface of the Overpass client. */
export interface OverpassClient {
  /**
   * List elements within a bounding box whose `seamark:type` tag matches the
   * given alternation regex, plus every `leisure=marina`. Resolves with a
   * normalized array (possibly empty). Rejects on any failure.
   */
  listPointsOfInterest: (bbox: Bbox, seamarkRegex: string) => Promise<OverpassElement[]>
  /**
   * Fetch one element by its typed id (`node/123`, `way/456`,
   * `relation/789`). Resolves with the element, or `undefined` when the query
   * succeeds but the element no longer exists. Rejects on any failure.
   */
  getById: (typedId: string) => Promise<OverpassElement | undefined>
  /**
   * Abort any in-flight requests and stop retrying. Call this from
   * plugin.stop so a late response cannot record onto a later run's state.
   */
  close: () => void
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
 * Parse a Retry-After header into a millisecond delay. The header may be an
 * integer count of seconds or an HTTP date. Returns undefined when absent or
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
 * Error thrown when the Overpass API returns a non-ok HTTP response. The
 * `status` lets callers tell a transient failure from a permanent one.
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
 * Clamp one bounding-box edge to at most `maxSpan` degrees, keeping its
 * midpoint fixed. A box already within the span is returned unchanged.
 */
function clampSpan (low: number, high: number, maxSpan: number): [number, number] {
  const span = high - low
  if (span <= maxSpan) {
    return [low, high]
  }
  const center = (low + high) / 2
  return [center - maxSpan / 2, center + maxSpan / 2]
}

/** Clamp both edges of a bounding box to {@link MAX_BBOX_SPAN_DEGREES}. */
function clampBbox (bbox: Bbox): Bbox {
  const [south, north] = clampSpan(bbox.south, bbox.north, MAX_BBOX_SPAN_DEGREES)
  const [west, east] = clampSpan(bbox.west, bbox.east, MAX_BBOX_SPAN_DEGREES)
  return { south, north, west, east }
}

/**
 * Build the Overpass QL for a bounding-box list query. The global `[bbox:...]`
 * setting uses the Overpass `south,west,north,east` order, and applies to
 * every statement in the query. `out center tags` returns full tags and, for
 * a way or a relation, a representative center point.
 */
function buildListQuery (bbox: Bbox, seamarkRegex: string): string {
  const { south, west, north, east } = clampBbox(bbox)
  return (
    `[out:json][timeout:${LIST_QUERY_TIMEOUT_SECONDS}][bbox:${south},${west},${north},${east}];` +
    '(' +
    `nwr["seamark:type"~"${seamarkRegex}"];` +
    // OpenStreetMap tags most marinas with `leisure=marina` rather than a
    // `seamark:type`, so they are fetched alongside the seamark features.
    'nwr["leisure"="marina"];' +
    ');' +
    'out center tags;'
  )
}

/** Build the Overpass QL for a single-element detail query. */
function buildDetailQuery (type: OsmElementType, id: number): string {
  return (
    `[out:json][timeout:${DETAIL_QUERY_TIMEOUT_SECONDS}];` +
    `${type}(id:${id});` +
    'out center tags;'
  )
}

/**
 * Parse a typed OSM id (`node/123`) into its element type and numeric id.
 * Throws on a malformed id rather than issuing a guaranteed-empty query.
 */
function parseTypedId (typedId: string): { type: OsmElementType, id: number } {
  const slash = typedId.indexOf('/')
  const type = slash > 0 ? typedId.slice(0, slash) : ''
  const id = Number(typedId.slice(slash + 1))
  if (
    (type !== 'node' && type !== 'way' && type !== 'relation') ||
    !Number.isInteger(id) || id <= 0
  ) {
    throw new Error(`Invalid OSM element id "${typedId}"`)
  }
  return { type, id }
}

/** A single element as it arrives on the Overpass wire. */
interface OverpassWireElement {
  type?: string
  id?: number
  lat?: number
  lon?: number
  center?: { lat?: number, lon?: number }
  tags?: Record<string, string>
}

/** Response body of an Overpass query. */
interface OverpassResponse {
  elements?: OverpassWireElement[]
}

/**
 * Normalize one wire element, resolving its position from `lat`/`lon` (a node)
 * or `center` (a way or a relation). Returns null for an element missing the
 * fields the source needs, so one bad element cannot fail the whole list.
 */
function parseElement (wire: OverpassWireElement): OverpassElement | null {
  if (wire == null) {
    return null
  }
  const type = wire.type
  if (type !== 'node' && type !== 'way' && type !== 'relation') {
    return null
  }
  if (!Number.isFinite(wire.id)) {
    return null
  }
  const lat = wire.lat ?? wire.center?.lat
  const lon = wire.lon ?? wire.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }
  return {
    type,
    id: wire.id as number,
    tags: wire.tags ?? {},
    position: { latitude: lat as number, longitude: lon as number }
  }
}

/**
 * Create an Overpass client.
 *
 * @param endpoint The Overpass interpreter URL every query is POSTed to.
 * @param log      Logging surface used for diagnostics.
 * @param options  Optional rate-limit overrides. Mainly used by tests to keep
 *                 them fast; production callers can pass just the endpoint and
 *                 the logger.
 */
export function createOverpassClient (
  endpoint: string,
  log: Logger,
  options: Partial<RateLimitOptions> = {}
): OverpassClient {
  const limits: RateLimitOptions = {
    maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    minDelayMs: options.minDelayMs ?? DEFAULT_MIN_DELAY_MS,
    backoffBaseMs: options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES
  }

  const queue = new RequestQueue(limits.maxConcurrency, limits.minDelayMs)

  // Aborted by close(): cancels in-flight fetches and stops further retries so
  // a response cannot land after the plugin has stopped.
  const closeController = new AbortController()

  /**
   * Perform a single fetch with retry/backoff. Retries network errors and
   * retryable HTTP statuses (429, 502, 503, 504). A 429 or 503 honors the
   * Retry-After header when present. The body of a discarded retryable
   * response is canceled so its socket is released promptly.
   */
  async function fetchWithRetry (init: RequestInit): Promise<Response> {
    let attempt = 0
    for (;;) {
      try {
        const response = await fetch(endpoint, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            closeController.signal
          ])
        })

        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= limits.maxRetries) {
          return response
        }

        const honorsRetryAfter =
          response.status === HTTP_TOO_MANY_REQUESTS ||
          response.status === HTTP_SERVICE_UNAVAILABLE
        const retryAfter = honorsRetryAfter
          ? parseRetryAfter(response.headers.get('retry-after'))
          : undefined
        // A Retry-After header is honored but still capped, so an upstream
        // sending a huge value cannot stall the request, and its queue slot,
        // for minutes or longer.
        const wait = Math.min(
          retryAfter ?? backoffDelay(attempt, limits.backoffBaseMs, limits.maxBackoffMs),
          limits.maxBackoffMs
        )
        log.debug(
          `Overpass request to ${endpoint} returned ${response.status}, ` +
          `retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${limits.maxRetries})`
        )
        // Release the socket: the retried response body is never read.
        await response.body?.cancel()
        await delay(wait)
        attempt++
      } catch (error) {
        // Do not retry once the client is closed, and do not retry past the
        // configured limit.
        if (closeController.signal.aborted || attempt >= limits.maxRetries) {
          throw error
        }
        const wait = backoffDelay(attempt, limits.backoffBaseMs, limits.maxBackoffMs)
        log.debug(
          `Overpass request to ${endpoint} failed (${String(error)}), ` +
          `retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${limits.maxRetries})`
        )
        await delay(wait)
        attempt++
      }
    }
  }

  /** Run an Overpass QL query and return its parsed, normalized elements. */
  async function runQuery (query: string, errorPrefix: string): Promise<OverpassElement[]> {
    const response = await queue.run(() => fetchWithRetry({
      method: 'POST',
      headers: { ...BASE_HEADERS },
      body: query
    }))

    await assertResponseOk(response, errorPrefix)

    const data = await response.json() as OverpassResponse
    if (!Array.isArray(data?.elements)) {
      throw new Error('Overpass response missing the elements array')
    }

    const parsed: OverpassElement[] = []
    for (const wire of data.elements) {
      const element = parseElement(wire)
      if (element !== null) {
        parsed.push(element)
      }
    }
    const skipped = data.elements.length - parsed.length
    if (skipped > 0) {
      log.debug(`Skipped ${skipped} malformed Overpass element(s)`)
    }
    return parsed
  }

  async function listPointsOfInterest (
    bbox: Bbox, seamarkRegex: string
  ): Promise<OverpassElement[]> {
    try {
      return await runQuery(
        buildListQuery(bbox, seamarkRegex),
        'Overpass list request failed'
      )
    } catch (error) {
      log.debug(`ERROR fetching Overpass elements ${JSON.stringify(bbox)} - ${String(error)}`)
      throw error
    }
  }

  async function getById (typedId: string): Promise<OverpassElement | undefined> {
    const { type, id } = parseTypedId(typedId)
    try {
      const elements = await runQuery(
        buildDetailQuery(type, id),
        `Overpass detail request failed for ${typedId}`
      )
      // An empty result is the API answering normally: the element has been
      // deleted from OpenStreetMap. The source turns this into a "not found".
      return elements[0]
    } catch (error) {
      log.debug(`ERROR fetching Overpass element ${typedId} - ${String(error)}`)
      throw error
    }
  }

  const close = (): void => {
    closeController.abort()
  }

  return { listPointsOfInterest, getById, close }
}
