/**
 * Plain-English HTML renderer for a USCG Local Notice to Mariners record.
 *
 * A "notice" record carries a rich `DESCRIPTION` the wire already writes in
 * plain English, so it is rendered largely verbatim. A "discrepancy" record
 * carries coded fields instead (the aid condition, its color, its structure
 * type), so this module humanizes those codes. The shared readers the
 * normalized-section builder reuses (`humanizeStatus`, `aidPhrase`,
 * `isInformativeCorrection`, and `layerLabel`) are exported so the HTML and the
 * structured detail produce identical text and cannot drift, mirroring the USCG
 * Light List renderer.
 */

import type { LnmDiscrepancyRecord, LnmNoticeRecord, LnmRecord } from './lnm-types.js'
import { LNM_LAYER_BY_SLUG } from './lnm-layers.js'
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'

/**
 * Plain-English phrases for the coded tokens that appear in a discrepancy's
 * status field, slash-separated on the wire (`LT EXT/OFF STATION`). A token
 * not in the table is kept verbatim, so a new USCG code still reads as its
 * shorthand rather than being dropped.
 */
const STATUS_TOKENS: Readonly<Record<string, string>> = {
  'STRUCT DEST': 'structure destroyed',
  'STRUCT DMGD': 'structure damaged',
  'STRUCT MISSING': 'structure missing',
  'DBD DEST': 'dayboard destroyed',
  'DBD DMGD': 'dayboard damaged',
  'DAYMK MISSING': 'daymark missing',
  'DAYMK DMGD': 'daymark damaged',
  'DAYMK IMCH': 'daymark showing improper characteristic',
  'TMK MISSING': 'topmark missing',
  'LT EXT': 'light extinguished',
  'LT IMCH': 'light showing improper characteristic',
  MISSING: 'missing',
  'OFF STATION': 'off station',
  'OFF STA': 'off station',
  ADRIFT: 'adrift',
  SINKING: 'sinking',
  LEANING: 'leaning',
  'HAZ NAV': 'hazard to navigation',
  TRUB: 'temporarily replaced by an unlighted buoy',
  TRLB: 'temporarily replaced by a lighted buoy',
  TRLT: 'temporarily replaced by a temporary light',
  TRDBN: 'temporarily replaced by a daybeacon',
  TRSAIS: 'temporarily replaced by a synthetic AIS signal',
  'SS INOP': 'sound signal inoperative',
  'RAC INOP': 'RACON inoperative',
  'RBN IMCH': 'radiobeacon showing improper characteristic',
  'AIS INOP': 'AIS inoperative',
  'REDUCED INT': 'reduced light intensity',
  'BUOY DMGD': 'buoy damaged',
  VEGETATION: 'obscured by vegetation',
  ESTABLISHED: 'established',
  DISCONTINUED: 'discontinued',
  RELOCATED: 'relocated',
  'RELOCATED FOR DREDGING': 'relocated for dredging',
  'DISCONTINUED FOR DREDGING': 'discontinued for dredging',
  'REMOVED DUE TO ICE': 'removed due to ice'
}

/** Plain-English names for the USCG color codes seen on the discrepancy wire. */
const COLOR_CODES: Readonly<Record<string, string>> = {
  W: 'white',
  R: 'red',
  G: 'green',
  Y: 'yellow',
  B: 'black',
  O: 'orange',
  BW: 'black and white',
  WO: 'white and orange',
  RW: 'red and white',
  RGR: 'red-green-red',
  GRG: 'green-red-green',
  BRB: 'black-red-black',
  RWR: 'red-white-red',
  WGW: 'white-green-white',
  WBu: 'white and blue'
}

/** Plain-English labels for the USCG structure (DESCRIPTION_TYPE) codes. */
const STRUCTURE_CODES: Readonly<Record<string, string>> = {
  LT: 'light',
  LB: 'lighted buoy',
  ULB: 'unlighted buoy',
  DBN: 'daybeacon',
  RF: 'range front',
  RR: 'range rear',
  VAIS: 'virtual AIS aid'
}

/** Status values that carry no useful correction detail, so they are hidden. */
const UNINFORMATIVE_CORRECTION = /unreported|^n\/a$/i

/** Humanize one slash-separated discrepancy status into a readable phrase. */
export function humanizeStatus (raw: string): string {
  return raw
    .split('/')
    .map((token) => {
      const key = token.trim().toUpperCase()
      return STATUS_TOKENS[key] ?? token.trim()
    })
    .filter((phrase) => phrase.length > 0)
    .join('; ')
}

/** Humanize a USCG color code, falling back to the raw code when unknown. */
function humanizeColor (raw: string): string {
  return COLOR_CODES[raw] ?? raw
}

/** Humanize a USCG structure code, falling back to the raw code when unknown. */
function structureLabel (raw: string): string {
  return STRUCTURE_CODES[raw] ?? raw
}

/**
 * Compose the "affected aid" phrase from a discrepancy's color and structure
 * codes, e.g. `green daybeacon`, or null when neither field is present.
 */
export function aidPhrase (record: LnmDiscrepancyRecord): string | null {
  const parts: string[] = []
  if (record.color !== undefined) parts.push(humanizeColor(record.color))
  if (record.descriptionType !== undefined) parts.push(structureLabel(record.descriptionType))
  return parts.length > 0 ? parts.join(' ') : null
}

/** True when a correction-status value is worth showing to the mariner. */
export function isInformativeCorrection (correctionStatus: string): boolean {
  return !UNINFORMATIVE_CORRECTION.test(correctionStatus)
}

/**
 * Human label for the producing layer, for the provenance line. Exported so the
 * normalized-section builder reuses one definition rather than repeating the
 * lookup.
 */
export function layerLabel (record: LnmRecord): string {
  return LNM_LAYER_BY_SLUG.get(record.layer)?.label ?? record.layer
}

/** Render the shared provenance line: Local Notice to Mariners, district, updated. */
function sourceLine (record: LnmRecord): string {
  const parts = [`USCG Local Notice to Mariners: ${layerLabel(record)}`]
  if (record.district !== undefined) {
    parts.push(`Coast Guard District ${record.district}`)
  }
  const updated = record.timestamp !== undefined
    ? ` (updated ${escapeHtml(record.timestamp.slice(0, 10))})`
    : ''
  return `<p><strong>Source:</strong> ${escapeHtml(parts.join(', '))}${updated}.</p>`
}

/** Render a notice record's plain-English body, preserving its line breaks. */
function noticeBody (description: string): string {
  const lines = description
    .split('\n')
    .map((line) => escapeHtml(line.trim()))
    .filter((line) => line.length > 0)
  return `<p>${lines.join('<br>')}</p>`
}

/** Render a "notice" record (hazNav, marCon, bridge, misc). */
function renderNotice (record: LnmNoticeRecord): string {
  const blocks: string[] = [`<h4>${escapeHtml(record.name)}</h4>`]
  if (record.subCategory !== undefined && record.noticeType !== undefined) {
    blocks.push(labeledParagraph('Category', `${record.subCategory}, ${record.noticeType}`))
  } else if (record.subCategory !== undefined) {
    blocks.push(labeledParagraph('Category', record.subCategory))
  } else if (record.noticeType !== undefined) {
    blocks.push(labeledParagraph('Type', record.noticeType))
  }
  if (record.waterway !== undefined) {
    blocks.push(labeledParagraph('Waterway', record.waterway))
  }
  if (record.description !== undefined) {
    blocks.push(noticeBody(record.description))
  }
  if (record.beginDate !== undefined && record.endDate !== undefined) {
    blocks.push(labeledParagraph(
      'Effective',
      `${record.beginDate.slice(0, 10)} to ${record.endDate.slice(0, 10)}`
    ))
  }
  blocks.push(sourceLine(record))
  return blocks.join('')
}

/** Render a "discrepancy" record (discFedAid, discPriAid, tmpChange). */
function renderDiscrepancy (record: LnmDiscrepancyRecord): string {
  const blocks: string[] = [`<h4>${escapeHtml(record.name)}</h4>`]
  if (record.status !== undefined) {
    blocks.push(labeledParagraph('Status', humanizeStatus(record.status)))
  }
  if (record.correctionStatus !== undefined && isInformativeCorrection(record.correctionStatus)) {
    blocks.push(labeledParagraph('Correction', record.correctionStatus))
  }
  const aid = aidPhrase(record)
  if (aid !== null) {
    blocks.push(labeledParagraph('Affected aid', aid))
  }
  if (record.waterway !== undefined) {
    blocks.push(labeledParagraph('Waterway', record.waterway))
  }
  if (record.llnr !== undefined) {
    blocks.push(labeledParagraph('LLNR', String(record.llnr)))
  }
  if (record.bnm !== undefined) {
    blocks.push(labeledParagraph('Broadcast Notice to Mariners', record.bnm))
  }
  blocks.push(sourceLine(record))
  return blocks.join('')
}

/** Render a USCG LNM record as a Freeboard-ready HTML description. */
export function renderLnmDetail (record: LnmRecord): string {
  return record.kind === 'notice' ? renderNotice(record) : renderDiscrepancy(record)
}
