/**
 * Conditional-GET envelope shared by the bulk-download sources.
 *
 * The USCG Light List, USCG LNM, and NOAA CO-OPS clients all download a whole
 * file (or station list) on a slow refresh cadence and want the same HTTP
 * dance: send `If-Modified-Since` and `If-None-Match` from the previous
 * response, treat a 304 as "unchanged, do no work", treat any other non-200 as
 * an error, and on a 200 hand back the raw body plus the fresh validators. Only
 * the parsing of that body differs between the three, so the envelope lives here
 * once and each client keeps its own parse step over the returned `body`.
 *
 * This builds on the raw `http-one-shot.ts` transport on purpose: each caller is
 * a low-volume background download that needs neither the queue nor the retry of
 * `http-client.ts`. The plugin's own descriptive `User-Agent` is sent on every
 * request.
 */

import { requestText } from './http-one-shot.js'
import { PLUGIN_USER_AGENT } from '../shared/plugin-id.js'
import { MS_PER_MINUTE } from '../shared/time.js'

/** HTTP status returned by the upstream when the resource has not changed. */
const HTTP_NOT_MODIFIED = 304

/** HTTP status returned by the upstream on a successful GET. */
const HTTP_OK = 200

/**
 * Per-request timeout in milliseconds. A silently dropped TCP connection (no
 * FIN, no RST, a transparent proxy black-holing the socket) would otherwise
 * stall a refresh worker indefinitely, holding up the concurrency-capped
 * refresh fan-out. The shared `http-client.ts` enforces an equivalent policy for
 * the queued sources; this raw path mirrors it.
 */
const REQUEST_TIMEOUT_MS = MS_PER_MINUTE

/** The cache validators carried across a conditional GET. */
export interface ConditionalGetHeaders {
  lastModified?: string
  etag?: string
}

/** Outcome of one conditional-GET attempt. Each caller parses `body` its own way. */
export type ConditionalGetResult =
  | { status: 'not-modified' }
  | { status: 'error', message: string }
  | { status: 'ok', body: string, headers: ConditionalGetHeaders }

/**
 * Issue a conditional GET to `url`, tagging the timeout and error with `label`.
 * `previousHeaders`, when supplied, seed the `If-Modified-Since` and
 * `If-None-Match` request headers so an unchanged resource answers 304. A 304
 * resolves with `{ status: 'not-modified' }`, any other non-200 with
 * `{ status: 'error', message: 'HTTP <code>' }`, and a 200 with the raw body and
 * the response's `last-modified` and `etag` validators. Network failures are
 * caught and returned as an `error` result rather than thrown.
 */
export async function conditionalGet (
  url: string,
  label: string,
  previousHeaders?: ConditionalGetHeaders,
  signal?: AbortSignal
): Promise<ConditionalGetResult> {
  const headers: Record<string, string> = { 'User-Agent': PLUGIN_USER_AGENT }
  if (previousHeaders?.lastModified !== undefined) {
    headers['If-Modified-Since'] = previousHeaders.lastModified
  }
  if (previousHeaders?.etag !== undefined) {
    headers['If-None-Match'] = previousHeaders.etag
  }
  try {
    const response = await requestText(url, headers, REQUEST_TIMEOUT_MS, label, signal)
    if (response.status === HTTP_NOT_MODIFIED) {
      return { status: 'not-modified' }
    }
    if (response.status !== HTTP_OK) {
      return { status: 'error', message: `HTTP ${response.status}` }
    }
    const responseHeaders: ConditionalGetHeaders = {}
    const lastModified = response.headers['last-modified']
    if (typeof lastModified === 'string') {
      responseHeaders.lastModified = lastModified
    }
    const etag = response.headers.etag
    if (typeof etag === 'string') {
      responseHeaders.etag = etag
    }
    return { status: 'ok', body: response.body, headers: responseHeaders }
  } catch (error) {
    if (signal?.aborted === true) {
      throw error
    }
    return { status: 'error', message: String(error) }
  }
}
