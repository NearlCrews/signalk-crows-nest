/**
 * Wire and parsed types for the USCG Local Notice to Mariners (LNM) GeoJSON
 * feed at navcen.uscg.gov.
 *
 * NAVCEN publishes the LNM as a set of per-category GeoJSON files under
 * `/sites/default/files/msi/`. Two distinct wire shapes appear across those
 * files, so this module models both:
 *
 * - A "notice" feature (Hazards to Navigation, Marine Construction, Bridges,
 *   Miscellaneous) carries a rich, plain-English `DESCRIPTION` plus a
 *   `TITLE`, an `MSI_GROUP` / `SUB_CATEGORY` / `TYPE` classification, and a
 *   set of epoch-millisecond dates.
 * - A "discrepancy" feature (Discrepant Federal Aids, Discrepant Private
 *   Aids, Temporary Changes) carries no free-text description: the useful
 *   content is the aid `NAME`, a coded `DISCREP_STATUS` (or `TC_STATUS` for a
 *   temporary change), the `AID_TYPE` / `COLOR` codes, and an `LLNR`.
 *
 * The wire ships an absent value as an explicit JSON `null` (or omits the key),
 * so every optional wire field is widened to allow `null`. The parsed
 * {@link LnmRecord} never carries `null`: the client treats null and undefined
 * identically as "absent" through the shared narrowing helpers.
 *
 * Both wire shapes are normalized into one discriminated {@link LnmRecord}
 * union so the store, the bbox query, and the summary path stay source-shape
 * agnostic; only the detail renderer and the section builder branch on `kind`.
 */

import type { Position } from '../../shared/types.js'
import type { PoiType } from '../../shared/types.js'
import type { USCG_LNM_SOURCE_ID } from '../../shared/source-ids.js'

/** Which of the two wire shapes a layer's features follow. */
export type LnmLayerKind = 'notice' | 'discrepancy'

/** A single LNM GeoJSON feature off the wire, either wire shape. */
export interface LnmFeature {
  type: 'Feature'
  id?: number | string
  geometry?: { type: string, coordinates?: [number, number] } | null
  properties?: (NoticeProperties & DiscrepancyProperties) | null
}

/** Wire properties for a "notice" feature (hazNav, marCon, bridge, misc). */
export interface NoticeProperties {
  /** Business id for a notice feature; equals ESRI_OID on the current wire. */
  MSI_UID?: number | null
  ESRI_OID?: number | null
  /** Coast Guard district number the notice belongs to. */
  ATU?: number | null
  TITLE?: string | null
  MSI_GROUP?: string | null
  SUB_CATEGORY?: string | null
  TYPE?: string | null
  WATERWAY_NAME?: string | null
  /** Plain-English notice body, often multi-line. */
  DESCRIPTION?: string | null
  CREATE_DATE?: number | null
  MODIFIED_DATE?: number | null
  BEGIN_DATE?: number | null
  END_DATE?: number | null
  DECIMAL_LATITUDE?: number | null
  DECIMAL_LONGITUDE?: number | null
}

/** Wire properties for a "discrepancy" feature (discFedAid, discPriAid, tmpChange). */
export interface DiscrepancyProperties {
  /** Business id for a discrepancy feature. */
  LNM_UID?: number | null
  ATON_UID?: number | null
  ESRI_OID?: number | null
  ATON_GROUP?: string | null
  LLNR?: number | null
  NAME?: string | null
  /** Coded discrepancy status for a discrepant aid, e.g. `LT EXT/OFF STATION`. */
  DISCREP_STATUS?: string | null
  DISCREP_CORR_STATUS?: string | null
  /** Coded temporary-change status, e.g. `RELOCATED FOR DREDGING`. */
  TC_STATUS?: string | null
  TC_CORR_STATUS?: string | null
  ATU?: number | null
  AID_TYPE?: string | null
  AID_SUBTYPE?: string | null
  COLOR?: string | null
  DESCRIPTION_TYPE?: string | null
  BNM_NUM?: string | null
  WATERWAY_NAME?: string | null
  CREATE_DATE?: number | null
  DECIMAL_LATITUDE?: number | null
  DECIMAL_LONGITUDE?: number | null
}

/** Fields every parsed LNM record carries, regardless of wire shape. */
interface LnmRecordBase {
  /** Source-internal id: `${layerSlug}_${businessId}`, namespaced by layer. */
  id: string
  /** Producing layer slug (see `lnm-layers.ts`), e.g. `haznav`. */
  layer: string
  position: Position
  /** Concise marker title. */
  name: string
  /** Cross-source POI type; `Hazard` for the danger layers so alarms fire. */
  poiType: PoiType
  /** Freeboard-registered icon glyph name. */
  skIcon: string
  source: typeof USCG_LNM_SOURCE_ID
  /** Coast Guard district number, when the wire carries one. */
  district?: number
  /** Waterway name, when the wire carries one. */
  waterway?: string
  /** ISO-8601 UTC timestamp (last-modified or create date), for the year context. */
  timestamp?: string
}

/** A parsed notice record (hazNav, marCon, bridge, misc). */
export interface LnmNoticeRecord extends LnmRecordBase {
  kind: 'notice'
  /** MSI_GROUP, e.g. `General`. */
  category?: string
  /** SUB_CATEGORY, e.g. `Hazards To Navigation`. */
  subCategory?: string
  /** TYPE, e.g. `Shoaling Reported`, `Dredging`. */
  noticeType?: string
  /** Plain-English notice body. */
  description?: string
  /** ISO-8601 UTC effective-from date, when the wire carries one. */
  beginDate?: string
  /** ISO-8601 UTC effective-to date, when the wire carries one. */
  endDate?: string
}

/** A parsed discrepancy record (discFedAid, discPriAid, tmpChange). */
export interface LnmDiscrepancyRecord extends LnmRecordBase {
  kind: 'discrepancy'
  /** ATON_GROUP, e.g. `DISCREPANCIES - FEDERAL AIDS`. */
  atonGroup?: string
  /** Raw coded status (DISCREP_STATUS or TC_STATUS); humanized at render time. */
  status?: string
  /** Raw correction status (DISCREP_CORR_STATUS or TC_CORR_STATUS). */
  correctionStatus?: string
  /** Raw AID_TYPE code. */
  aidType?: string
  /** Raw AID_SUBTYPE code. */
  aidSubtype?: string
  /** Raw single-letter (or multi-letter) COLOR code. */
  color?: string
  /** Raw DESCRIPTION_TYPE code, e.g. `LT`, `DBN`, `LB`. */
  descriptionType?: string
  /** Light List Number of the affected aid, when the wire carries one. */
  llnr?: number
  /** Broadcast Notice to Mariners number, when the wire carries one. */
  bnm?: string
}

/** A parsed LNM record, either wire shape. */
export type LnmRecord = LnmNoticeRecord | LnmDiscrepancyRecord

/** Headers from a successful download, used for conditional GET. */
export interface LnmFileHeaders {
  lastModified?: string
  etag?: string
}

/** One persisted LNM file: its conditional-GET headers plus its parsed records. */
export interface LnmFileEntry {
  headers: LnmFileHeaders
  records: LnmRecord[]
}

/** The on-disk store shape: one entry per pinned (layer, page) file. */
export interface LnmIndex {
  generated: string
  files: Record<string, LnmFileEntry>
}
