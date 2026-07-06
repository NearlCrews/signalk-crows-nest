/**
 * NGA World Port Index HTTP client.
 *
 * Issues a single GET against the NGA Maritime Safety Information publications
 * API and returns the parsed port list. The endpoint is not bounding-box
 * queryable: it answers with the whole worldwide index (about 2950 ports) in
 * one response, so there is no paging, and the source fetches the full set and
 * filters it in memory. That is why this client is one method rather than the
 * bbox-and-paging shape the ArcGIS-backed sources use; it shares only the
 * raw one-shot transport in `http-one-shot.ts`.
 *
 * The plugin's descriptive `User-Agent` is sent on the request, matching every
 * other upstream client.
 */

import { requestJson } from '../http-one-shot.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { MS_PER_MINUTE } from '../../shared/time.js'
import type { WpiListResponse, WpiPort } from './wpi-types.js'

/**
 * Default NGA MSI host. The World Port Index is published under Pub 150 at
 * this authoritative access point; a full-dump download in the current schema
 * lives at `/api/publications/world-port-index`.
 */
const DEFAULT_BASE_URL = 'https://msi.nga.mil'

/**
 * Per-request timeout in milliseconds. The full dump is a few megabytes, so
 * the window is generous; it exists to abort a hung TCP connection (a dropped
 * TLS handshake, a black-hole proxy) rather than to bound a slow-but-alive
 * download. Mirrors the ENC Direct raw client's policy.
 */
const REQUEST_TIMEOUT_MS = MS_PER_MINUTE

export interface WpiClient {
  /** Fetch the full World Port Index. Rejects on a transport or HTTP error. */
  fetchAllPorts: (signal?: AbortSignal) => Promise<WpiPort[]>
}

export interface WpiClientConfig {
  baseUrl?: string
}

/** Build the full-dump request URL for the current-schema WPI export. */
function buildUrl (base: string): string {
  return `${base}/api/publications/world-port-index?output=json`
}

/** Create the World Port Index client. */
export function createWpiClient (config: WpiClientConfig = {}): WpiClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const headers = { 'User-Agent': PLUGIN_USER_AGENT }
  return {
    async fetchAllPorts (signal) {
      const url = buildUrl(baseUrl)
      const parsed = await requestJson(
        url, headers, REQUEST_TIMEOUT_MS, 'World Port Index', signal
      ) as WpiListResponse
      return parsed.ports ?? []
    }
  }
}
