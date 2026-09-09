/**
 * One-shot HTTP GET shared by the low-volume raw clients.
 *
 * The bulk-download and ArcGIS clients bypass the queued, retrying
 * `http-client.ts` because each is a low-volume request stream. They share the
 * raw socket plumbing: select the `http` or `https` transport, buffer a bounded
 * response body, and enforce a wall-clock deadline so a silent or trickling
 * connection cannot hang the caller forever.
 *
 * The helper returns the status, the decoded body, and the response headers and
 * leaves every status-code and body interpretation to the caller: the Light
 * List client needs the headers for conditional GET and treats 304/200
 * specially, while the ENC client rejects on non-2xx and parses JSON. Neither
 * policy belongs in the shared transport.
 *
 * Compression is handled here because `node:http` neither advertises an
 * `Accept-Encoding` nor decodes a response, unlike the `fetch`-based clients
 * that get both from undici. Every one-shot download therefore transferred
 * uncompressed, which cost roughly 5.7 MB per World Port Index refresh and
 * 1.3 MB per USACE dam viewport query against public government services and a
 * vessel's satellite link.
 */

import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { Readable, Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip } from 'node:zlib'

/**
 * Upper bound for a buffered one-shot response body, counted against the
 * DECODED bytes. The cap exists to stop a hostile or broken upstream
 * exhausting the plugin process's memory, and it is the decoded body the
 * process holds.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/**
 * Raised when a response body crosses the caller's cap, by either transport.
 * The queued client retries around it by class, so both transports raise this
 * one type rather than a bare `Error` each phrases for itself.
 */
export class ResponseTooLargeError extends Error {
  constructor (label: string, url: string, maxResponseBytes: number) {
    super(`${label} response exceeds ${maxResponseBytes} bytes: ${url}`)
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * Content codings this transport advertises, in the `Accept-Encoding` order
 * sent on every request. It lists exactly what {@link chooseDecoder} decodes,
 * so a compliant upstream cannot pick something the caller's parse path would
 * then be handed raw. `deflate` is deliberately absent: servers disagree on
 * whether it names the zlib-wrapped or the raw stream, and no upstream this
 * plugin talks to offers it. Measured 2026-09-09: NGA MSI, NOAA CO-OPS, NOAA
 * ENC Direct, and the USACE dams service answer `gzip`; the USACE Locks
 * FeatureServer on services7.arcgis.com answers `br`; NAVCEN compresses
 * nothing, so the Light List and LNM downloads simply stay uncompressed.
 */
const ACCEPT_ENCODING = 'gzip, br'

/** What to do with a response body, resolved from its `Content-Encoding`. */
type DecoderChoice =
  | { kind: 'identity' }
  | { kind: 'decode', decoder: Transform }
  | { kind: 'unsupported', coding: string }

/**
 * Resolve a response's `Content-Encoding` to a decoder. An absent or
 * `identity` coding needs none; anything outside {@link ACCEPT_ENCODING} is
 * reported so the caller fails by name rather than passing compressed bytes to
 * a JSON parser.
 */
function chooseDecoder (headers: IncomingHttpHeaders): DecoderChoice {
  const header = headers['content-encoding']
  const coding = (typeof header === 'string' ? header : '').trim().toLowerCase()
  if (coding === '' || coding === 'identity') return { kind: 'identity' }
  // `x-gzip` is the legacy alias a few servers still emit for the same coding.
  if (coding === 'gzip' || coding === 'x-gzip') {
    return { kind: 'decode', decoder: createGunzip() }
  }
  if (coding === 'br') return { kind: 'decode', decoder: createBrotliDecompress() }
  return { kind: 'unsupported', coding }
}

/**
 * Whether a status carries no response body. A 304 in particular may repeat
 * the header fields a 200 would have sent, `Content-Encoding` among them, and
 * handing a decompressor zero bytes fails it with "unexpected end of file", so
 * the conditional-GET path must not decode one.
 */
function statusHasNoBody (status: number): boolean {
  return status === 204 || status === 304 || (status >= 100 && status < 200)
}

/**
 * The caller's headers with {@link ACCEPT_ENCODING} added, unless the caller
 * already set one under any capitalization. Node sends this object's keys as
 * given, so an unconditional add would put two `Accept-Encoding` lines on the
 * wire for a caller that supplied its own.
 */
function withAcceptEncoding (headers: Record<string, string>): Record<string, string> {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'accept-encoding') return headers
  }
  return { ...headers, 'Accept-Encoding': ACCEPT_ENCODING }
}

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
 * to completion unread. `maxResponseBytes` bounds the DECODED body so a bad
 * upstream cannot exhaust the plugin process's memory, whether it compresses
 * or not.
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
    // Held in the promise scope so the deadline and abort handlers tear the
    // decompressor down alongside the request rather than leaving it open.
    let decoder: Transform | null = null

    const cleanup = (): void => {
      clearTimeout(deadline)
      signal?.removeEventListener('abort', onAbort)
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      decoder?.destroy()
      reject(error)
    }
    const resolveOnce = (response: OneShotResponse): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }

    const req = transport(url, { method: 'GET', headers: withAcceptEncoding(headers) }, res => {
      const status = res.statusCode ?? 0
      // A bodyless status is read as plain even when it echoes a
      // `Content-Encoding`, because there are no bytes to decode.
      const choice: DecoderChoice = statusHasNoBody(status)
        ? { kind: 'identity' }
        : chooseDecoder(res.headers)
      if (choice.kind === 'unsupported') {
        const error = new Error(
          `${label} response used unsupported Content-Encoding "${choice.coding}": ${url}`
        )
        rejectOnce(error)
        res.destroy(error)
        req.destroy()
        return
      }

      const chunks: Buffer[] = []
      let decodedBytes = 0

      // `Content-Length` describes the wire. For a compressed body that is the
      // compressed size, which says nothing about how far it inflates, so this
      // cheap up-front rejection is only sound when nothing will be decoded;
      // the streaming check below carries the compressed case.
      if (choice.kind === 'identity') {
        const advertisedLength = Number(res.headers['content-length'])
        if (Number.isFinite(advertisedLength) && advertisedLength > maxResponseBytes) {
          const error = new ResponseTooLargeError(label, url, maxResponseBytes)
          rejectOnce(error)
          res.destroy(error)
          req.destroy()
          return
        }
      }

      // The body is read off the DECODED stream, and the cap is counted there:
      // a compressed body of a few kilobytes can inflate to gigabytes, so a
      // limit enforced on the wire bytes would not bound what this process
      // actually holds. zlib emits output as input arrives, so crossing the
      // cap aborts mid-inflation rather than after the whole body has expanded.
      const decoded: Readable = choice.kind === 'decode' ? choice.decoder : res
      if (choice.kind === 'decode') {
        decoder = choice.decoder
        res.on('error', rejectOnce)
        // A truncated or corrupt body fails inside zlib with a terse message
        // ("incorrect header check"). Re-tag it with the feed label so it
        // reaches the caller's status recording reading like every other
        // transport failure, rather than escaping as a bare stream error.
        choice.decoder.on('error', (error: Error) => {
          rejectOnce(new Error(
            `${label} response could not be decoded: ${error.message}: ${url}`
          ))
        })
        res.pipe(choice.decoder)
      } else {
        res.on('error', rejectOnce)
      }
      decoded.on('data', (chunk: Buffer) => {
        decodedBytes += chunk.length
        if (decodedBytes > maxResponseBytes) {
          const error = new ResponseTooLargeError(label, url, maxResponseBytes)
          rejectOnce(error)
          res.destroy(error)
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      decoded.on('end', () => {
        resolveOnce({
          status,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers
        })
      })
      res.on('aborted', () => {
        rejectOnce(new Error(`${label} response ended prematurely: ${url}`))
      })
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
