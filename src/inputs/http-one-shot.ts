/**
 * One-shot HTTP GET shared by the low-volume raw clients.
 *
 * The bulk-download and ArcGIS clients bypass the queued, retrying
 * `http-client.ts` because each is a low-volume request stream. They share the
 * raw socket plumbing: select the `http` or `https` transport, buffer a bounded
 * response body, and enforce a wall-clock deadline so a silent or trickling
 * connection cannot hang the caller forever.
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

/** Upper bound for a buffered one-shot response body. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/** Raw response captured by {@link requestText}. */
export interface OneShotResponse {
  status: number
  body: string
  headers: IncomingHttpHeaders
}

/**
 * Issue a single GET to `url` with the given headers and resolve with the raw
 * response. `timeoutMs` is a wall-clock deadline and rejects with an error
 * tagged `label` so the caller's source can record which feed timed out. An
 * optional `signal` cancels an in-flight
 * request when the caller's deadline passes, so an abandoned query does not run
 * to completion unread. `maxResponseBytes` bounds the buffered body so a bad
 * upstream cannot exhaust the plugin process's memory.
 */
export function requestText (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<OneShotResponse> {
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      reject(new RangeError('timeoutMs must be a positive finite number'))
      return
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      reject(new RangeError('maxResponseBytes must be a positive safe integer'))
      return
    }
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error(`${label} request aborted: ${url}`))
      return
    }

    const transport = url.startsWith('https:') ? httpsRequest : httpRequest
    let settled = false

    const cleanup = (): void => {
      clearTimeout(deadline)
      signal?.removeEventListener('abort', onAbort)
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const resolveOnce = (response: OneShotResponse): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }

    const req = transport(url, { method: 'GET', headers }, res => {
      const chunks: Buffer[] = []
      let receivedBytes = 0
      const advertisedLength = Number(res.headers['content-length'])
      if (Number.isFinite(advertisedLength) && advertisedLength > maxResponseBytes) {
        const error = new Error(
          `${label} response exceeds ${maxResponseBytes} bytes: ${url}`
        )
        rejectOnce(error)
        res.destroy(error)
        req.destroy()
        return
      }
      res.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > maxResponseBytes) {
          const error = new Error(
            `${label} response exceeds ${maxResponseBytes} bytes: ${url}`
          )
          rejectOnce(error)
          res.destroy(error)
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        resolveOnce({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers
        })
      })
      res.on('aborted', () => {
        rejectOnce(new Error(`${label} response ended prematurely: ${url}`))
      })
      res.on('error', rejectOnce)
    })
    const onAbort = (): void => {
      const reason = signal?.reason instanceof Error
        ? signal.reason
        : new Error(`${label} request aborted: ${url}`)
      rejectOnce(reason)
      req.destroy()
    }
    const deadline = setTimeout(() => {
      const error = new Error(`${label} request timed out after ${timeoutMs} ms: ${url}`)
      rejectOnce(error)
      req.destroy()
    }, timeoutMs)
    deadline.unref()
    req.on('error', rejectOnce)
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
  signal?: AbortSignal,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<unknown> {
  const response = await requestText(
    url,
    headers,
    timeoutMs,
    label,
    signal,
    maxResponseBytes
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} HTTP ${response.status} for ${url}`)
  }
  return JSON.parse(response.body)
}
