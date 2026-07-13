/**
 * USCG Local Notice to Mariners HTTP client.
 *
 * Issues GET requests against the NAVCEN MSI GeoJSON files and parses each
 * feature into an {@link LnmRecord}, branching on the layer's wire shape.
 * Supports conditional GET via If-Modified-Since and If-None-Match, so a
 * refresh tick that finds no upstream change does no parsing work. The file
 * URLs follow the pattern
 * `<baseUrl>/sites/default/files/msi/<fileBase>_<page>.geojson`.
 *
 * The client is deliberately built on the raw one-shot transport rather than
 * the queued, retrying `http-client.ts`: the LNM refresh is a low-volume,
 * background bulk download (a handful of conditional GETs on a slow cadence),
 * mirroring the USCG Light List client's use of the same transport.
 */

import type { LnmLayer } from './lnm-layers.js'
import type {
  DiscrepancyProperties,
  LnmDiscrepancyRecord,
  LnmFeature,
  LnmFileHeaders,
  LnmNoticeRecord,
  LnmRecord,
  NoticeProperties
} from './lnm-types.js'
import { conditionalGet } from '../http-conditional-get.js'
import { USCG_LNM_SOURCE_ID } from '../../shared/source-ids.js'
import { finiteOrUndefined, isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import { presentString } from '../../shared/strings.js'

/** Default upstream host for the NAVCEN Maritime Safety Information files. */
const DEFAULT_BASE_URL = 'https://navcen.uscg.gov'

/** Result of a single (layer, page) download attempt. */
export type DownloadResult =
  | { status: 'ok', records: LnmRecord[], headers: LnmFileHeaders }
  | { status: 'not-modified' }
  | { status: 'error', message: string }

/** Public surface of the USCG LNM client. */
export interface LnmClient {
  /**
   * Download one (layer, page) file. Supplies the previous request's headers,
   * when known, for conditional GET; the upstream returns 304 (and this
   * resolves with `{ status: 'not-modified' }`) when the file has not changed.
   */
  downloadLayerPage: (
    layer: LnmLayer,
    page: number,
    previousHeaders?: LnmFileHeaders,
    signal?: AbortSignal
  ) => Promise<DownloadResult>
}

/** Optional overrides for the client. The base URL is the only knob today. */
export interface LnmClientConfig {
  /** Upstream origin to fetch from. Defaults to the public NAVCEN host. */
  baseUrl?: string
}

/**
 * Convert an epoch-millisecond wire date to an ISO-8601 UTC string, or
 * undefined when it is absent or the `0` sentinel. NAVCEN occasionally ships
 * `0` for an unknown date, which would decode to a January 1970 timestamp and
 * read as absurdly stale, so it is treated as absent, matching the USCG Light
 * List client's handling of `MODIFIED_DATE`.
 */
function epochToIso (value: number | null | undefined): string | undefined {
  const ms = finiteOrUndefined(value)
  if (ms === undefined || ms <= 0) return undefined
  return new Date(ms).toISOString()
}

/**
 * Resolve the stable business id for a feature, preferring the category's
 * own unique id and falling back to the GeoJSON top-level `id` (the ESRI
 * object id). Returns undefined when none is a finite number, so the caller
 * drops a feature that cannot be given a stable, click-through-able id.
 */
function businessId (
  feature: LnmFeature,
  ...candidates: Array<number | null | undefined>
): number | undefined {
  for (const candidate of candidates) {
    const value = finiteOrUndefined(candidate)
    if (value !== undefined) return value
  }
  return typeof feature.id === 'number' ? feature.id : undefined
}

/** Extract and validate the `[longitude, latitude]` pair from a feature. */
function featureLatLon (
  feature: LnmFeature,
  props: NoticeProperties & DiscrepancyProperties
): { lat: number, lon: number } | null {
  // Prefer the decimal-degree properties the wire carries alongside the
  // geometry; fall back to the geometry coordinates when a property is absent.
  const lat = finiteOrUndefined(props.DECIMAL_LATITUDE) ?? feature.geometry?.coordinates?.[1]
  const lon = finiteOrUndefined(props.DECIMAL_LONGITUDE) ?? feature.geometry?.coordinates?.[0]
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) return null
  return { lat, lon }
}

/** The first slash-delimited segment of a notice TITLE, used as a last-resort name. */
function firstTitleSegment (title: string): string {
  const [head] = title.split('/')
  return head.trim()
}

/** Derive a concise marker name for a notice feature. */
function noticeName (props: NoticeProperties, layer: LnmLayer): string {
  const waterway = presentString(props.WATERWAY_NAME)
  const type = presentString(props.TYPE)
  const sub = presentString(props.SUB_CATEGORY)
  if (waterway !== undefined && type !== undefined) return `${waterway}: ${type}`
  if (waterway !== undefined && sub !== undefined) return `${waterway}: ${sub}`
  if (type !== undefined) return type
  if (sub !== undefined) return sub
  const title = presentString(props.TITLE)
  if (title !== undefined) return firstTitleSegment(title)
  return layer.label
}

/** Parse a "notice" feature (hazNav, marCon, bridge, misc) into a record. */
function parseNoticeFeature (feature: LnmFeature, layer: LnmLayer): LnmNoticeRecord | null {
  const props = feature.properties
  if (props == null) return null
  const latLon = featureLatLon(feature, props)
  if (latLon === null) return null
  const id = businessId(feature, props.MSI_UID, props.ESRI_OID)
  if (id === undefined) return null
  const record: LnmNoticeRecord = {
    kind: 'notice',
    id: `${layer.slug}_${id}`,
    layer: layer.slug,
    position: { latitude: latLon.lat, longitude: latLon.lon },
    name: noticeName(props, layer),
    poiType: layer.poiType,
    skIcon: layer.skIcon,
    source: USCG_LNM_SOURCE_ID
  }
  const district = finiteOrUndefined(props.ATU)
  if (district !== undefined) record.district = district
  const waterway = presentString(props.WATERWAY_NAME)
  if (waterway !== undefined) record.waterway = waterway
  const category = presentString(props.MSI_GROUP)
  if (category !== undefined) record.category = category
  const subCategory = presentString(props.SUB_CATEGORY)
  if (subCategory !== undefined) record.subCategory = subCategory
  const noticeType = presentString(props.TYPE)
  if (noticeType !== undefined) record.noticeType = noticeType
  const description = presentString(props.DESCRIPTION)
  if (description !== undefined) record.description = description
  const beginDate = epochToIso(props.BEGIN_DATE)
  if (beginDate !== undefined) record.beginDate = beginDate
  const endDate = epochToIso(props.END_DATE)
  if (endDate !== undefined) record.endDate = endDate
  const timestamp = epochToIso(props.MODIFIED_DATE) ?? epochToIso(props.CREATE_DATE)
  if (timestamp !== undefined) record.timestamp = timestamp
  return record
}

/** Parse a "discrepancy" feature (discFedAid, discPriAid, tmpChange) into a record. */
function parseDiscrepancyFeature (feature: LnmFeature, layer: LnmLayer): LnmDiscrepancyRecord | null {
  const props = feature.properties
  if (props == null) return null
  const latLon = featureLatLon(feature, props)
  if (latLon === null) return null
  const id = businessId(feature, props.LNM_UID, props.ATON_UID, props.ESRI_OID)
  if (id === undefined) return null
  const record: LnmDiscrepancyRecord = {
    kind: 'discrepancy',
    id: `${layer.slug}_${id}`,
    layer: layer.slug,
    position: { latitude: latLon.lat, longitude: latLon.lon },
    name: presentString(props.NAME) ?? layer.label,
    poiType: layer.poiType,
    skIcon: layer.skIcon,
    source: USCG_LNM_SOURCE_ID
  }
  const district = finiteOrUndefined(props.ATU)
  if (district !== undefined) record.district = district
  const waterway = presentString(props.WATERWAY_NAME)
  if (waterway !== undefined) record.waterway = waterway
  const atonGroup = presentString(props.ATON_GROUP)
  if (atonGroup !== undefined) record.atonGroup = atonGroup
  // A discrepant aid carries DISCREP_STATUS; a temporary change carries
  // TC_STATUS in the same slot. Either one is the aid's coded condition.
  const status = presentString(props.DISCREP_STATUS) ?? presentString(props.TC_STATUS)
  if (status !== undefined) record.status = status
  const correctionStatus =
    presentString(props.DISCREP_CORR_STATUS) ?? presentString(props.TC_CORR_STATUS)
  if (correctionStatus !== undefined) record.correctionStatus = correctionStatus
  const aidType = presentString(props.AID_TYPE)
  if (aidType !== undefined) record.aidType = aidType
  const aidSubtype = presentString(props.AID_SUBTYPE)
  if (aidSubtype !== undefined) record.aidSubtype = aidSubtype
  const color = presentString(props.COLOR)
  if (color !== undefined) record.color = color
  const descriptionType = presentString(props.DESCRIPTION_TYPE)
  if (descriptionType !== undefined) record.descriptionType = descriptionType
  const llnr = finiteOrUndefined(props.LLNR)
  if (llnr !== undefined) record.llnr = llnr
  const bnm = presentString(props.BNM_NUM)
  if (bnm !== undefined) record.bnm = bnm
  const timestamp = epochToIso(props.CREATE_DATE)
  if (timestamp !== undefined) record.timestamp = timestamp
  return record
}

/** Parse one GeoJSON feature according to the layer's wire shape. */
function parseFeature (feature: LnmFeature, layer: LnmLayer): LnmRecord | null {
  return layer.kind === 'notice'
    ? parseNoticeFeature(feature, layer)
    : parseDiscrepancyFeature(feature, layer)
}

/** Create a new USCG LNM client. */
export function createLnmClient (config: LnmClientConfig = {}): LnmClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  return {
    async downloadLayerPage (layer, page, previousHeaders, signal) {
      const url = `${baseUrl}/sites/default/files/msi/${layer.fileBase}_${page}.geojson`
      const result = await conditionalGet(url, 'USCG LNM', previousHeaders, signal)
      if (result.status !== 'ok') {
        return result
      }
      const collection = JSON.parse(result.body) as { features?: LnmFeature[] }
      const records: LnmRecord[] = []
      for (const feature of collection.features ?? []) {
        const parsed = parseFeature(feature, layer)
        if (parsed !== null) {
          records.push(parsed)
        }
      }
      return { status: 'ok', records, headers: result.headers }
    }
  }
}
