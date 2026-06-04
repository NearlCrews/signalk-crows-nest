/**
 * Wire and parsed types for the USCG Light List GeoJSON feed.
 *
 * The MSI GeoJSON files at navcen.uscg.gov return a standard FeatureCollection
 * with one Feature per Aid to Navigation. The wire shape carries every USCG
 * field; the parsed shape (LightListRecord) strips the fields the plugin
 * never displays.
 *
 * The wire ships an absent value as an explicit JSON `null` rather than a
 * missing key, so every optional wire field below is widened to allow `null`
 * alongside the declared type. The parsed shape never carries `null`: the
 * client treats null and undefined identically as "absent".
 */

import type { Position } from '../../shared/types.js'

/** A single USCG Light List feature off the wire. */
export interface LightListFeature {
  type: 'Feature'
  id?: number | string
  geometry: { type: 'Point', coordinates: [number, number] }
  properties: LightListProperties
}

/** Every wire property the USCG MSI feed publishes that the plugin reads. */
export interface LightListProperties {
  LIGHT_LIST_NUMBER: number
  NAME: string
  DECIMAL_LATITUDE: number
  DECIMAL_LONGITUDE: number
  LIGHT_CHAR?: string | null
  LIGHT_NOM_RANGE?: number | null
  LIGHT_NOM_RANGE_UNIT?: string | null
  LIGHT_FOCAL_PLANE?: number | null
  LIGHT_FOCAL_PLANE_UNIT?: string | null
  STRUCTURE_TYPE?: string | null
  STRUCTURE_HEIGHT?: number | null
  STRUCTURE_HEIGHT_UNIT?: string | null
  DAYMARK_SHAPE?: string | null
  DAYMARK_COLOR?: string | null
  SOUND_EMITTER_TYPE?: string | null
  RACON_MORSE_CHARACTER?: string | null
  AID_TYPE?: string | null
  AID_SUBTYPE?: string | null
  REMARK?: string | null
  /**
   * Volume number. Arrives on the wire as a zero-padded string (`"01"`,
   * `"02"`), and the client coerces it to a number at parse time.
   */
  VOLUME_NUMBER: string | number
  MODIFIED_DATE?: number | null
  INACTIVE?: string | null
  // Other fields exist on the wire; the client ignores them on parse.
}

/** A single Light List feature as stored in the plugin's in-memory index. */
export interface LightListRecord {
  llnr: number
  name: string
  position: Position
  lightChar?: string
  nominalRange?: { value: number, unit: string }
  focalPlane?: { value: number, unit: string }
  structureType?: string
  structureHeight?: { value: number, unit: string }
  daymarkShape?: string
  daymarkColor?: string
  soundEmitterType?: string
  racon?: string
  aidType?: string
  aidSubtype?: string
  remark?: string
  district: string
  volume: number
  source: 'usclightlist'
  modifiedDate?: string
  inactive: boolean
}

/** Headers from a successful GeoJSON download, used for conditional GET. */
export interface DistrictHeaders {
  lastModified?: string
  etag?: string
}

/** Metadata about one downloaded district file. */
export interface DistrictMeta extends DistrictHeaders {
  recordCount: number
  fetchedAt: string
  /**
   * LLNRs that came from this district file. Persisted so a re-upsert can
   * remove the previous record set before adding the new one, even across a
   * cold start. Tracked per (district, page) because one district has up to
   * fifteen pages and the LightListRecord shape carries only the district,
   * not the page.
   */
  llnrs: number[]
}

/** The on-disk index: per-district metadata plus the merged record map. */
export interface LightListIndex {
  generated: string
  districts: Record<string, DistrictMeta>
  records: Record<string, LightListRecord>
}
