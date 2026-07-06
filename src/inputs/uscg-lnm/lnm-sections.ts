/**
 * Normalized-section builder for a USCG Local Notice to Mariners record.
 *
 * Turns the parsed {@link LnmRecord} into the source-agnostic
 * {@link NormalizedSection}[] a structured chartplotter renders, carried on the
 * note's `properties.crowsNest.sections` alongside the HTML description. It
 * mirrors the content of `lnm-detail.ts`'s HTML renderer (same humanized values,
 * via the shared helpers) but emits structured items rather than markup. An
 * empty section is dropped so a record missing a field does not show an empty
 * heading.
 */

import type { LnmDiscrepancyRecord, LnmNoticeRecord, LnmRecord } from './lnm-types.js'
import { aidPhrase, humanizeStatus, isInformativeCorrection, layerLabel } from './lnm-detail.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/** The shared provenance section items every record carries. */
function sourceItems (record: LnmRecord): NormalizedItem[] {
  const items: NormalizedItem[] = [{ label: 'Notice', value: layerLabel(record), kind: 'text' }]
  if (record.district !== undefined) {
    items.push({ label: 'Coast Guard District', value: record.district, kind: 'text' })
  }
  if (record.timestamp !== undefined) {
    items.push({ label: 'Updated', value: record.timestamp.slice(0, 10), kind: 'text' })
  }
  return items
}

/** Build the sections for a "notice" record. */
function noticeSections (record: LnmNoticeRecord): NormalizedSection[] {
  const sections: NormalizedSection[] = []

  const about: NormalizedItem[] = []
  if (record.subCategory !== undefined) {
    about.push({ label: 'Category', value: record.subCategory, kind: 'text' })
  }
  if (record.noticeType !== undefined) {
    about.push({ label: 'Type', value: record.noticeType, kind: 'text' })
  }
  if (record.waterway !== undefined) {
    about.push({ label: 'Waterway', value: record.waterway, kind: 'text' })
  }
  if (record.beginDate !== undefined) {
    about.push({ label: 'Effective from', value: record.beginDate.slice(0, 10), kind: 'text' })
  }
  if (record.endDate !== undefined) {
    about.push({ label: 'Effective to', value: record.endDate.slice(0, 10), kind: 'text' })
  }
  pushSection(sections, 'notice', 'Notice', about)

  if (record.description !== undefined) {
    pushSection(sections, 'description', 'Description', [
      { label: 'Notice text', value: record.description, kind: 'note' }
    ])
  }

  pushSection(sections, 'source', 'Source', sourceItems(record))
  return sections
}

/** Build the sections for a "discrepancy" record. */
function discrepancySections (record: LnmDiscrepancyRecord): NormalizedSection[] {
  const sections: NormalizedSection[] = []

  const condition: NormalizedItem[] = []
  if (record.status !== undefined) {
    condition.push({ label: 'Status', value: humanizeStatus(record.status), kind: 'text' })
  }
  if (record.correctionStatus !== undefined && isInformativeCorrection(record.correctionStatus)) {
    condition.push({ label: 'Correction', value: record.correctionStatus, kind: 'text' })
  }
  const aid = aidPhrase(record)
  if (aid !== null) {
    condition.push({ label: 'Affected aid', value: aid, kind: 'text' })
  }
  if (record.waterway !== undefined) {
    condition.push({ label: 'Waterway', value: record.waterway, kind: 'text' })
  }
  pushSection(sections, 'condition', 'Aid condition', condition)

  const identity: NormalizedItem[] = []
  if (record.llnr !== undefined) {
    identity.push({ label: 'LLNR', value: record.llnr, kind: 'text' })
  }
  if (record.bnm !== undefined) {
    identity.push({ label: 'Broadcast Notice to Mariners', value: record.bnm, kind: 'text' })
  }
  pushSection(sections, 'identity', 'Affected aid identity', identity)

  pushSection(sections, 'source', 'Source', sourceItems(record))
  return sections
}

/** Build the normalized detail sections for a USCG LNM record. */
export function buildLnmSections (record: LnmRecord): NormalizedSection[] {
  return record.kind === 'notice' ? noticeSections(record) : discrepancySections(record)
}
