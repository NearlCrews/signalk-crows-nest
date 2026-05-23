/**
 * USCG Light List HTTP client.
 *
 * Issues GET requests against the NAVCEN MSI GeoJSON files and parses each
 * feature into a LightListRecord. Supports conditional GET via
 * If-Modified-Since and If-None-Match so a daily refresh tick that finds no
 * upstream change does no work. The 37 file URLs follow the pattern
 * `<baseUrl>/sites/default/files/msi/lightList{district}_{page}.geojson`.
 */

import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type {
  DistrictHeaders,
  LightListFeature,
  LightListProperties,
  LightListRecord
} from './light-list-types.js'

/** Descriptive User-Agent identifying the plugin to the USCG NAVCEN service. */
const USER_AGENT = 'signalk-crows-nest (+https://github.com/nlabadie/signalk-crows-nest)'

/** Default upstream host for the NAVCEN Maritime Safety Information files. */
const DEFAULT_BASE_URL = 'https://navcen.uscg.gov'

/** HTTP status returned by the upstream when the file has not changed. */
const HTTP_NOT_MODIFIED = 304

/** HTTP status returned by the upstream on a successful GET. */
const HTTP_OK = 200

/** Result of a single district download attempt. */
export type DownloadResult =
  | { status: 'ok', records: LightListRecord[], headers: DistrictHeaders }
  | { status: 'not-modified' }
  | { status: 'error', message: string }

/** Public surface of the USCG Light List client. */
export interface LightListClient {
  /**
   * Download one district file. Supplies the previous request's headers, when
   * known, for conditional GET; the upstream returns 304 (and this resolves
   * with `{ status: 'not-modified' }`) when the file has not changed.
   */
  downloadDistrict: (
    district: string,
    page: number,
    previousHeaders?: DistrictHeaders
  ) => Promise<DownloadResult>
}

/** Optional overrides for the client. The base URL is the only knob today. */
export interface LightListClientConfig {
  /** Upstream origin to fetch from. Defaults to the public NAVCEN host. */
  baseUrl?: string
}

/** Plain HTTP response captured by {@link fetchUrl}. */
interface RawResponse {
  status: number
  body: string
  headers: IncomingHttpHeaders
}

/**
 * Issue a single GET to `url` with the given headers and resolve with the raw
 * response. Uses Node's `http`/`https` modules directly (rather than the
 * shared `http-client.ts`) because the Light List feed is a daily, low-volume,
 * polite request stream that does not need queueing, throttling, or retry: a
 * one-shot conditional GET against 37 static files served from a CDN.
 */
function fetchUrl (
  url: string,
  headers: Record<string, string>
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? httpsRequest : httpRequest
    const req = transport(url, { headers, method: 'GET' }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Return `value` when it is a non-empty string, otherwise undefined. The MSI
 * wire ships absent values as an explicit `null` rather than a missing key, so
 * every optional-field copy guards through this helper to keep `null` out of
 * the parsed record shape.
 */
function presentString (value: string | null | undefined): string | undefined {
  if (value == null || value === '') {
    return undefined
  }
  return value
}

/**
 * Return `value` when it is a finite number, otherwise undefined. Wire numbers
 * may arrive as `null` (absent) and the renderer requires a finite value.
 */
function presentNumber (value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Parse a single GeoJSON feature into the in-memory record shape. */
function parseFeature (
  feature: LightListFeature,
  district: string
): LightListRecord | null {
  const properties = feature.properties
  if (typeof properties?.LIGHT_LIST_NUMBER !== 'number') {
    return null
  }
  const latitude = properties.DECIMAL_LATITUDE
  const longitude = properties.DECIMAL_LONGITUDE
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }
  // The wire ships VOLUME_NUMBER as a zero-padded string (`"01"`), but the
  // parsed record carries a clean numeric volume so the renderer reads as
  // "Volume 1" rather than "Volume 01". A non-numeric volume is treated as
  // an invalid record.
  const volume = Number(properties.VOLUME_NUMBER)
  if (!Number.isFinite(volume)) {
    return null
  }
  const record: LightListRecord = {
    llnr: properties.LIGHT_LIST_NUMBER,
    name: properties.NAME ?? '',
    position: { latitude, longitude },
    district,
    volume,
    source: 'usclightlist',
    inactive: properties.INACTIVE === '1'
  }
  copyOptionalProperties(properties, record)
  return record
}

/**
 * Copy every optional wire field the renderer reads onto the parsed record.
 * Pulled out of {@link parseFeature} so the construction of the required
 * fields stays readable. Every copy goes through {@link presentString} or
 * {@link presentNumber} so a wire `null` is treated as "absent" rather than
 * leaking into the parsed shape.
 */
function copyOptionalProperties (
  properties: LightListProperties,
  record: LightListRecord
): void {
  const lightChar = presentString(properties.LIGHT_CHAR)
  if (lightChar !== undefined) record.lightChar = lightChar
  const color = presentString(properties.COLOR)
  if (color !== undefined) record.color = color
  const range = presentNumber(properties.LIGHT_NOM_RANGE)
  const rangeUnit = presentString(properties.LIGHT_NOM_RANGE_UNIT)
  if (range !== undefined && rangeUnit !== undefined) {
    record.nominalRange = { value: range, unit: rangeUnit }
  }
  const focal = presentNumber(properties.LIGHT_FOCAL_PLANE)
  const focalUnit = presentString(properties.LIGHT_FOCAL_PLANE_UNIT)
  if (focal !== undefined && focalUnit !== undefined) {
    record.focalPlane = { value: focal, unit: focalUnit }
  }
  const structureType = presentString(properties.STRUCTURE_TYPE)
  if (structureType !== undefined) record.structureType = structureType
  const height = presentNumber(properties.STRUCTURE_HEIGHT)
  const heightUnit = presentString(properties.STRUCTURE_HEIGHT_UNIT)
  if (height !== undefined && heightUnit !== undefined) {
    record.structureHeight = { value: height, unit: heightUnit }
  }
  const daymarkShape = presentString(properties.DAYMARK_SHAPE)
  if (daymarkShape !== undefined) record.daymarkShape = daymarkShape
  const daymarkColor = presentString(properties.DAYMARK_COLOR)
  if (daymarkColor !== undefined) record.daymarkColor = daymarkColor
  const sound = presentString(properties.SOUND_EMITTER_TYPE)
  if (sound !== undefined) record.soundEmitterType = sound
  const racon = presentString(properties.RACON_MORSE_CHARACTER)
  if (racon !== undefined) record.racon = racon
  const aidType = presentString(properties.AID_TYPE)
  if (aidType !== undefined) record.aidType = aidType
  const aidSubtype = presentString(properties.AID_SUBTYPE)
  if (aidSubtype !== undefined) record.aidSubtype = aidSubtype
  const remark = presentString(properties.REMARK)
  if (remark !== undefined) record.remark = remark
  const modified = presentNumber(properties.MODIFIED_DATE)
  if (modified !== undefined) {
    record.modifiedDate = new Date(modified).toISOString()
  }
}

/** Create a new USCG Light List client. */
export function createLightListClient (
  config: LightListClientConfig = {}
): LightListClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  return {
    async downloadDistrict (district, page, previousHeaders) {
      const url = `${baseUrl}/sites/default/files/msi/lightList${district}_${page}.geojson`
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
      if (previousHeaders?.lastModified !== undefined) {
        headers['If-Modified-Since'] = previousHeaders.lastModified
      }
      if (previousHeaders?.etag !== undefined) {
        headers['If-None-Match'] = previousHeaders.etag
      }
      try {
        const response = await fetchUrl(url, headers)
        if (response.status === HTTP_NOT_MODIFIED) {
          return { status: 'not-modified' }
        }
        if (response.status !== HTTP_OK) {
          return { status: 'error', message: `HTTP ${response.status}` }
        }
        const collection = JSON.parse(response.body) as { features?: LightListFeature[] }
        const records: LightListRecord[] = []
        for (const feature of collection.features ?? []) {
          const parsed = parseFeature(feature, district)
          if (parsed !== null) {
            records.push(parsed)
          }
        }
        const lastModified = response.headers['last-modified']
        const etag = response.headers.etag
        const responseHeaders: DistrictHeaders = {}
        if (typeof lastModified === 'string') {
          responseHeaders.lastModified = lastModified
        }
        if (typeof etag === 'string') {
          responseHeaders.etag = etag
        }
        return { status: 'ok', records, headers: responseHeaders }
      } catch (error) {
        return { status: 'error', message: String(error) }
      }
    }
  }
}
