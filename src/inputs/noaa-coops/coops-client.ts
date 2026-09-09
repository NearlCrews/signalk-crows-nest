/**
 * NOAA CO-OPS metadata API (mdapi) HTTP client.
 *
 * Issues a GET against the keyless mdapi station endpoint for one station type
 * and parses each wire station into a CoopsStationRecord. The two station lists
 * are small (a few hundred entries each) and change rarely, so this client
 * builds on the one-shot `http-one-shot.ts` transport rather than the queued,
 * retrying client, matching the USCG Light List and NOAA ENC clients.
 *
 * Conditional GET (If-Modified-Since / If-None-Match) is best-effort: the
 * headers are sent when a previous response supplied them and a 304 is honored,
 * but the mdapi is a dynamic JSON service that may ignore them and answer 200
 * every time, which is still correct.
 */

import type {
  CoopsStationHeaders,
  CoopsStationRecord,
  CoopsStationType,
  CoopsStationsResponse,
  CoopsWireStation
} from './noaa-coops-types.js'
import { conditionalGet } from '../http-conditional-get.js'
import { NOAA_COOPS_SOURCE_ID } from '../../shared/source-ids.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import { presentString } from '../../shared/strings.js'

/** Default upstream host for the CO-OPS metadata API. */
const DEFAULT_BASE_URL = 'https://api.tidesandcurrents.noaa.gov'

/** The mdapi `type` query value for each station family. */
const API_TYPE: Readonly<Record<CoopsStationType, string>> = {
  tide: 'waterlevels',
  current: 'currents'
}

/** Result of a single station-list download attempt. */
export type CoopsDownloadResult =
  | { status: 'ok', records: CoopsStationRecord[], headers: CoopsStationHeaders }
  | { status: 'not-modified' }
  | { status: 'error', message: string }

/** Public surface of the CO-OPS client. */
export interface CoopsClient {
  /**
   * Download the station list for one type. Supplies the previous response's
   * headers, when known, for a best-effort conditional GET; a 304 resolves with
   * `{ status: 'not-modified' }`.
   */
  downloadStations: (
    stationType: CoopsStationType,
    previousHeaders?: CoopsStationHeaders,
    signal?: AbortSignal
  ) => Promise<CoopsDownloadResult>
}

/** Optional overrides for the client. The base URL is the only knob today. */
export interface CoopsClientConfig {
  /** Upstream origin to fetch from. Defaults to the public mdapi host. */
  baseUrl?: string
}

/** Parse a single wire station into the in-memory record shape, or null when unusable. */
function parseStation (
  station: CoopsWireStation,
  stationType: CoopsStationType
): CoopsStationRecord | null {
  const rawId = typeof station.id === 'number' ? String(station.id) : presentString(station.id)
  if (rawId === undefined) {
    return null
  }
  const latitude = station.lat
  const longitude = station.lng
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return null
  }
  // Every CO-OPS station carries a name; fall back to the id so a rare blank
  // still gives the chart marker a popup title rather than rendering empty.
  const name = presentString(station.name) ?? `Station ${rawId}`
  const record: CoopsStationRecord = {
    id: rawId,
    stationType,
    name,
    position: { latitude, longitude },
    source: NOAA_COOPS_SOURCE_ID
  }
  const state = presentString(station.state)
  if (state !== undefined) {
    record.state = state
  }
  const timezone = presentString(station.timezone)
  if (timezone !== undefined) {
    record.timezone = timezone
  }
  return record
}

/** Create a new NOAA CO-OPS client. */
export function createCoopsClient (config: CoopsClientConfig = {}): CoopsClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  return {
    async downloadStations (stationType, previousHeaders, signal) {
      const url = `${baseUrl}/mdapi/prod/webapi/stations.json?type=${API_TYPE[stationType]}`
      const result = await conditionalGet(url, 'NOAA CO-OPS', previousHeaders, signal)
      if (result.status !== 'ok') {
        return result
      }
      const parsed = JSON.parse(result.body) as CoopsStationsResponse | null
      const stations = parsed?.stations
      // The mdapi always answers with a stations array, empty when the family
      // holds nothing. Anything else is valid JSON in a shape this parser does
      // not know, so it is reported as a failure rather than coerced to an
      // empty list: the refresh treats an empty list as authoritative and
      // would drop every station stored for this family.
      if (!Array.isArray(stations)) {
        return { status: 'error', message: 'response carried no stations array' }
      }
      const records: CoopsStationRecord[] = []
      for (const station of stations) {
        const record = parseStation(station, stationType)
        if (record !== null) {
          records.push(record)
        }
      }
      // A list that arrived full and yielded no record is what an upstream
      // field rename looks like, and it is reported as a failure rather than
      // as an empty family. The caller replaces a station family wholesale
      // with what it is handed, and an empty list is authoritative there, so
      // passing this up as a success would drop every stored station.
      if (records.length === 0 && stations.length > 0) {
        return {
          status: 'error',
          message: `${stations.length} stations on the wire, none parseable`
        }
      }
      return { status: 'ok', records, headers: result.headers }
    }
  }
}
