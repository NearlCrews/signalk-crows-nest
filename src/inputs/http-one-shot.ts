/**
 * One-shot HTTP GET shared by the two raw-client sources.
 *
 * The USCG Light List and NOAA ENC Direct clients both bypass the queued,
 * retrying `http-client.ts` on purpose: each is a low-volume request stream
 * (37 daily conditional GETs; a handful of bbox queries per scan) that needs
 * neither queueing nor retry. What they DO share is the raw socket plumbing:
 * pick the `http`/`https` transport from the URL scheme, buffer the response
 * body, and abort on a per-request timeout so a silently dropped TCP
 * connection cannot hang the caller forever. That plumbing lives here once
 * rather than in two copies.
 *
 * The helper returns the status, the raw body, and the response headers and
 * leaves every status-code and body interpretation to the caller: the Light
 * List client needs the headers for conditional GET and treats 304/200
 * specially, while the ENC client rejects on non-2xx and parses JSON. Neither
 * policy belongs in the shared transport.
 */

import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'

/** Raw response captured by {@link requestText}. */
export interface OneShotResponse {
  status: number
  body: string
  headers: IncomingHttpHeaders
}

/**
 * Issue a single GET to `url` with the given headers and resolve with the raw
 * response. `timeoutMs` aborts a hung connection (no FIN, no RST, a black-hole
 * proxy) and rejects with an error tagged `label` so the caller's source can
 * record which feed timed out. An optional `signal` cancels an in-flight
 * request when the caller's deadline passes, so an abandoned query does not run
 * to completion unread.
 */
export function requestText (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<OneShotResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error(`${label} request aborted: ${url}`))
      return
    }
    const transport = url.startsWith('https:') ? httpsRequest : httpRequest
    const req = transport(url, { method: 'GET', headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        signal?.removeEventListener('abort', onAbort)
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers
        })
      })
      res.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
    })
    const onAbort = (): void => {
      req.destroy(signal?.reason ?? new Error(`${label} request aborted: ${url}`))
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${label} request timed out after ${timeoutMs} ms: ${url}`))
    })
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    req.end()
  })
}

/**
 * Issue a one-shot GET and parse the body as JSON, rejecting non-2xx statuses
 * with a `label`-tagged error. The shared envelope for the raw JSON clients
 * (the ArcGIS paging protocol and the World Port Index full dump); callers
 * narrow the returned value themselves. JSON.parse throws only a SyntaxError
 * (already an Error), so the parse is returned directly: a try/catch that
 * rethrows the same value would be a no-op.
 */
export async function requestJson (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await requestText(url, headers, timeoutMs, label, signal)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} HTTP ${response.status} for ${url}`)
  }
  return JSON.parse(response.body)
}
