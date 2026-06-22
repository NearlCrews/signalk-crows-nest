/**
 * EMODnet bathymetry depth-profile client. GET-only on the shared one-shot
 * transport (low-volume, one request per EU leg, honors the caller signal,
 * degrades on failure, no auth needed). The depth_profile endpoint returns a
 * flat JSON array of signed depth values or null, one per DTM cell, in meters
 * referenced to LAT. WKT axis order is longitude then latitude.
 */

import { requestText } from '../../inputs/http-one-shot.js'
import { isFiniteNumber } from '../../shared/numbers.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { MS_PER_SECOND } from '../../shared/time.js'
import type { Position } from '../../shared/types.js'

const BASE_URL = 'https://rest.emodnet-bathymetry.eu/depth_profile'
// 15 s, shorter than the ENC and USCG clients' full minute: depth_profile
// returns a single flat array, far less than a paginated ArcGIS bbox query, so
// a tighter timeout still fits inside the route-draft deadline.
const REQUEST_TIMEOUT_MS = 15 * MS_PER_SECOND

/**
 * A parsed depth profile. `samples` is the non-null signed depths in meters
 * (negative below LAT). `hadGap` is true when the profile carried at least one
 * null cell alongside data, so the consumer can warn that the leg was only
 * partially modeled. An all-null or empty profile yields empty samples and
 * hadGap false (it is no data, not a partial gap).
 */
export interface EmodnetProfile {
  samples: number[]
  hadGap: boolean
}

export interface EmodnetClient {
  depthProfile: (from: Position, to: Position, signal?: AbortSignal) => Promise<EmodnetProfile>
}

export interface EmodnetClientDeps {
  // Mirror the real one-shot GET so the test stub cannot drift from its signature.
  requestText?: typeof requestText
}

function lonLat (p: Position): string {
  return `${p.longitude} ${p.latitude}`
}

export function createEmodnetClient (deps: EmodnetClientDeps = {}): EmodnetClient {
  const get = deps.requestText ?? requestText
  return {
    depthProfile: async (from, to, signal): Promise<EmodnetProfile> => {
      const geom = encodeURIComponent(`LINESTRING(${lonLat(from)},${lonLat(to)})`)
      const url = `${BASE_URL}?geom=${geom}`
      const res = await get(url, { 'User-Agent': PLUGIN_USER_AGENT, Accept: 'application/json' }, REQUEST_TIMEOUT_MS, 'EMODnet', signal)
      if (res.status < 200 || res.status >= 300) throw new Error(`EMODnet depth_profile failed: HTTP ${res.status}`)
      if (res.status === 204 || res.body.trim() === '') return { samples: [], hadGap: false }
      let raw: unknown
      try {
        raw = JSON.parse(res.body)
      } catch {
        throw new Error('EMODnet depth_profile returned non-JSON')
      }
      if (!Array.isArray(raw)) throw new Error('EMODnet depth_profile did not return an array')
      // One pass collects the finite samples and notes any null gap, rather than two traversals.
      let hadNull = false
      const samples: number[] = []
      for (const v of raw) {
        if (v === null) hadNull = true
        else if (isFiniteNumber(v)) samples.push(v)
      }
      return { samples, hadGap: hadNull && samples.length > 0 }
    }
  }
}
