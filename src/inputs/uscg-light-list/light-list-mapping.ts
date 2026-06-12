/**
 * AID_TYPE, AID_SUBTYPE, and INACTIVE to PoiType and Freeboard skIcon mapping
 * for USCG Light List records.
 *
 * Every Light List entry is a navigation aid, so PoiType is always
 * `Navigational`. The Freeboard icon is `navigation-structure` by default;
 * isolated-danger AtoNs get the `hazard` glyph (matching the existing
 * OpenSeaMap pattern, where the PoiType stays `Navigational` so the proximity
 * alarm does not falsely trigger on the buoy itself), and inactive aids get
 * the `notice-to-mariners` glyph so they read as informational on the chart.
 */

import type { LightListRecord } from './light-list-types.js'
import type { PoiType } from '../../shared/types.js'

/** Pattern that matches the USCG abbreviations for an isolated-danger mark. */
const ISOLATED_DANGER_SUBTYPE_PATTERN = /\bISO\/DG\b|\bIDM\b/i

/** Pattern that matches a free-text "isolated danger" mention in REMARK. */
const ISOLATED_DANGER_REMARK_PATTERN = /isolated\s+danger/i

/** True when an aid is an isolated-danger mark, by subtype or remark. */
export function isIsolatedDanger (record: LightListRecord): boolean {
  if (
    record.aidSubtype !== undefined &&
    ISOLATED_DANGER_SUBTYPE_PATTERN.test(record.aidSubtype)
  ) {
    return true
  }
  if (
    record.remark !== undefined &&
    ISOLATED_DANGER_REMARK_PATTERN.test(record.remark)
  ) {
    return true
  }
  return false
}

/** The PoiType for every Light List record, matching the NOAA sibling's `LAYER_POI_TYPE` shape. */
export const LIGHT_LIST_POI_TYPE: PoiType = 'Navigational'

/** Resolve the Freeboard skIcon glyph for a Light List record. */
export function recordSkIcon (record: LightListRecord): string {
  if (record.inactive) {
    return 'notice-to-mariners'
  }
  if (isIsolatedDanger(record)) {
    return 'hazard'
  }
  return 'navigation-structure'
}
