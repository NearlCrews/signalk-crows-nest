/**
 * Shared HTTP-client plumbing for the plugin's POI-source clients.
 *
 * The ActiveCaptain and Overpass clients both need the same machinery: a
 * concurrency-limited, throttled request queue, retry with exponential backoff
 * that honors HTTP 429 and 503 Retry-After headers, and a close() that aborts
 * in-flight work and stops the retry loop. That machinery lives here once;
 * each client supplies its own base URL, headers, request body, response
 * parsing, per-request timeout, and rate-limit defaults.
 */

import type { Logger } from '../shared/types.js'
import { parseRetryAfterMs } from '../shared/retry-after.js'
import { combineAbortSignals } from '../shared/abort.js'

/** Tunable rate-limit knobs. All optional at the call site; defaults fill gaps. */
export interface RateLimitOptions {
  /** Maximum number of in-flight requests at once. */
  maxConcurrency: number
  /** Minimum spacing, in milliseconds, between request starts. */
  minDelayMs: number
  /** Base delay for exponential backoff, in milliseconds. */
  backoffBaseMs: number
  /** Upper bound for a single backoff wait, in milliseconds. */
  maxBackoffMs: number
  /**
   * Maximum retry attempts after the first try, for 429, 502, 503, and 504
   * responses, and network errors.
   */
  maxRetries: number
  /**
   * Upper bound on how long a server-supplied Retry-After header is honored,
   * in milliseconds. Decoupled from `maxBackoffMs` (which caps exponential
   * backoff): Overpass legitimately sends 60-120 s cooldowns and capping at
   * the smaller `maxBackoffMs` truncates that into another instant 429. A
   * 5 min ceiling lets a genuine cooldown ride out while still protecting
   * against a misbehaving edge sending an absurd value.
   * `closeController.abort()` still cancels the wait on plugin stop.
   */
  maxRetryAfterMs: number
}

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
 * Other 4xx responses (notably 404) are permanent and are never retried.
 */
const RETRYABLE_STATUSES = new Set<number>([
  HTTP_TOO_MANY_REQUESTS, HTTP_BAD_GATEWAY, HTTP_SERVICE_UNAVAILABLE, HTTP_GATEWAY_TIMEOUT
])

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * A concurrency-limited, throttled task queue. It caps the number of in-flight
 * tasks and enforces a minimum spacing between task starts.
 */
class RequestQueue {
  private active = 0
  private nextAllowedStart = 0
  private closed = false
  private readonly waiting: Array<{ start: () => void, abandon: (error: Error) => void }> = []
  private readonly scheduled = new Map<NodeJS.Timeout, () => void>()

  constructor (
    private readonly label: string,
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

  /**
   * Tear the queue down for an immediate, clean stop. Every start already
   * paced behind a throttle timer fires now (its task sees the aborted close
   * signal and rejects at once), and every queued waiter rejects now, so a
   * deep queue does not keep firing one doomed task per `minDelayMs` after
   * the plugin has stopped.
   */
  close (): void {
    this.closed = true
    for (const [timer, start] of this.scheduled) {
      clearTimeout(timer)
      start()
    }
    this.scheduled.clear()
    for (const waiter of this.waiting.splice(0)) {
      waiter.abandon(this.closedError())
    }
  }

  private closedError (): Error {
    return new Error(`${this.label} client closed`)
  }

  private acquire (): Promise<void> {
    if (this.closed) {
      return Promise.reject(this.closedError())
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ start: resolve, abandon: reject })
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
    const timer: NodeJS.Timeout = setTimeout(() => {
      this.scheduled.delete(timer)
      next.start()
    }, wait)
    this.scheduled.set(timer, next.start)
  }

  private release (): void {
    this.active--
    this.pump()
  }
}

/** Exponential backoff with full jitter for the given zero-based attempt. */
function backoffDelay (attempt: number, baseMs: number, maxMs: number): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.random() * ceiling
}

/**
 * Error thrown when an HTTP response is not ok. The `status` lets callers tell
 * a transient failure from a permanent one, for example a 404 for an entity
 * that no longer exists.
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
export async function assertResponseOk (response: Response, errorPrefix: string): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(`${errorPrefix}: ${response.status} ${response.statusText}`, response.status)
  }
}

/** Configuration for {@link createHttpClient}. */
export interface HttpClientConfig {
  /**
   * Diagnostic label used in retry log lines, e.g. `"ActiveCaptain"` or
   * `"Overpass"`. Logged as `${label} request to ${url} returned ...`.
   */
  label: string
  /**
   * Per-request HTTP timeout, in milliseconds. The queue slot is held across
   * retries and their backoff waits, not freed when one attempt times out, so
   * a hung upstream costs at most one queue slot for the full retry sequence
   * before the request fails.
   */
  requestTimeoutMs: number
  /** Default rate-limit knobs; per-call options override individual fields. */
  defaults: RateLimitOptions
}

/** A rate-limited HTTP client that retries on 429, 502, 503, 504, and network errors. */
export interface HttpClient {
  /**
   * Run one request through the queue, retrying with exponential backoff that
   * honors Retry-After on 429 and 503. Resolves with the final Response;
   * non-ok responses are returned to the caller, which typically routes them
   * through {@link assertResponseOk}. A caller-supplied `init.signal` is
   * combined with the per-request timeout and the plugin-stop close controller,
   * so the caller's deadline, the timeout, and plugin stop can each abort the
   * request; omit it for the prior timeout-and-close behavior.
   */
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /**
   * Abort any in-flight requests and stop retrying. Call this from
   * plugin.stop so a late response cannot record onto a later run's state.
   */
  close: () => void
}

/**
 * A `setTimeout`-driven millisecond sleep. The default `sleep` implementation
 * for {@link createHttpClient}; injectable for tests.
 */
export type Sleep = (ms: number) => Promise<void>

/**
 * Build a rate-limited HTTP client.
 *
 * @param log     Logging surface used for retry diagnostics.
 * @param config  Per-client identity, timeout, and rate-limit defaults.
 * @param options Optional rate-limit overrides; fields not set fall back to
 *                {@link HttpClientConfig.defaults}.
 * @param sleep   Optional millisecond-sleep injection. Defaults to a
 *                `setTimeout`-driven sleep; tests pass a spy that records the
 *                requested ms and resolves immediately, so timing-sensitive
 *                tests can assert the requested wait instead of waiting it.
 */
export function createHttpClient (
  log: Logger,
  config: HttpClientConfig,
  options: Partial<RateLimitOptions> = {},
  sleep: Sleep = delay
): HttpClient {
  const limits: RateLimitOptions = {
    maxConcurrency: options.maxConcurrency ?? config.defaults.maxConcurrency,
    minDelayMs: options.minDelayMs ?? config.defaults.minDelayMs,
    backoffBaseMs: options.backoffBaseMs ?? config.defaults.backoffBaseMs,
    maxBackoffMs: options.maxBackoffMs ?? config.defaults.maxBackoffMs,
    maxRetries: options.maxRetries ?? config.defaults.maxRetries,
    maxRetryAfterMs: options.maxRetryAfterMs ?? config.defaults.maxRetryAfterMs
  }

  const queue = new RequestQueue(config.label, limits.maxConcurrency, limits.minDelayMs)

  // Aborted by close(): cancels in-flight fetches and stops further retries so
  // a response cannot land after the plugin has stopped.
  const closeController = new AbortController()

  async function fetchWithRetry (url: string, init: RequestInit): Promise<Response> {
    let attempt = 0
    for (;;) {
      try {
        // The per-request timeout and plugin-stop close-controller always abort
        // the request. A caller-supplied `init.signal` (a route-draft deadline,
        // say) is folded in too when present, so all three can cancel an
        // in-flight fetch. When the caller passes none, the behavior is exactly
        // the prior two-signal combine. The `?? undefined` is load-bearing:
        // RequestInit.signal is `AbortSignal | null | undefined` and
        // combineAbortSignals filters only `undefined`, so a raw null would reach
        // AbortSignal.any and throw; do not simplify it away.
        const response = await fetch(url, {
          ...init,
          signal: combineAbortSignals([
            AbortSignal.timeout(config.requestTimeoutMs),
            closeController.signal,
            init.signal ?? undefined
          ])
        })

        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= limits.maxRetries) {
          return response
        }

        const honorsRetryAfter =
          response.status === HTTP_TOO_MANY_REQUESTS ||
          response.status === HTTP_SERVICE_UNAVAILABLE
        const retryAfter = honorsRetryAfter
          ? parseRetryAfterMs(response.headers.get('retry-after'))
          : undefined
        // Cap a server-supplied Retry-After at `maxRetryAfterMs` rather than
        // `maxBackoffMs`: an Overpass 60 s cooldown truncated to 30 s would
        // just produce another instant 429. Floor it at `backoffBaseMs` so
        // a degenerate `Retry-After: 0` or a past HTTP date does not let
        // the client burn every remaining retry attempt in the same
        // event-loop tick. Exponential backoff stays capped at
        // `maxBackoffMs`; both knobs are per-client tunable.
        const wait = retryAfter !== undefined
          ? Math.max(limits.backoffBaseMs, Math.min(retryAfter, limits.maxRetryAfterMs))
          : backoffDelay(attempt, limits.backoffBaseMs, limits.maxBackoffMs)
        log.debug(
          `${config.label} request to ${url} returned ${response.status}, ` +
          `retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${limits.maxRetries})`
        )
        // Release the socket: the retried response body is never read.
        await response.body?.cancel()
        await sleep(wait)
        attempt++
      } catch (error) {
        // Do not retry once the client is closed, once the caller's own signal
        // has aborted (a route-draft deadline must reject promptly, not burn
        // the whole retry budget with backoff first), or past the configured
        // limit.
        if (
          closeController.signal.aborted ||
          init.signal?.aborted === true ||
          attempt >= limits.maxRetries
        ) {
          throw error
        }
        const wait = backoffDelay(attempt, limits.backoffBaseMs, limits.maxBackoffMs)
        log.debug(
          `${config.label} request to ${url} failed (${String(error)}), ` +
          `retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${limits.maxRetries})`
        )
        await sleep(wait)
        attempt++
      }
    }
  }

  return {
    fetch: (url, init) => queue.run(() => fetchWithRetry(url, init)),
    close: () => {
      // Abort before draining the queue, so a queued task the drain fires
      // immediately sees the aborted signal and rejects without a request.
      closeController.abort()
      queue.close()
    }
  }
}
