/**
 * Normalized-section builder for a USCG Light List record.
 *
 * Turns the structured {@link LightListRecord} into the source-agnostic
 * {@link NormalizedSection}[] a structured chart plotter renders, carried on
 * the note's `properties.crowsNest.sections` alongside the HTML description.
 *
 * It mirrors the content of `light-list-detail.ts`'s HTML renderer (same
 * humanized values, via the shared helpers) but emits structured items rather
 * than markup. An empty section is dropped so a daymark-only aid does not show
 * an empty "Light" heading. The full rollout would have the HTML renderer
 * derive its output from these sections so the two cannot drift; this builder
 * is the first source onto the normalized schema.
 */

import type { LightListRecord } from './light-list-types.js'
import { humanizeLightChar, rangeUnit, heightUnit } from './light-list-detail.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/** Build the normalized detail sections for a Light List record. */
export function buildLightListSections (record: LightListRecord): NormalizedSection[] {
  const sections: NormalizedSection[] = []

  const light: NormalizedItem[] = []
  if (record.lightChar !== undefined) {
    light.push({ label: 'Character', value: humanizeLightChar(record.lightChar), kind: 'text' })
  }
  if (record.nominalRange !== undefined) {
    light.push({ label: 'Nominal range', value: record.nominalRange.value, kind: 'measure', unit: rangeUnit(record.nominalRange.unit) })
  }
  if (record.focalPlane !== undefined) {
    light.push({ label: 'Focal plane', value: record.focalPlane.value, kind: 'measure', unit: heightUnit(record.focalPlane.unit) })
  }
  pushSection(sections, 'light', 'Light', light)

  const structure: NormalizedItem[] = []
  if (record.structureType !== undefined) {
    structure.push({ label: 'Type', value: record.structureType, kind: 'text' })
  }
  if (record.structureHeight !== undefined) {
    structure.push({ label: 'Height', value: record.structureHeight.value, kind: 'measure', unit: heightUnit(record.structureHeight.unit) })
  }
  pushSection(sections, 'structure', 'Structure', structure)

  const daymark: NormalizedItem[] = []
  if (record.daymarkColor !== undefined) {
    daymark.push({ label: 'Color', value: record.daymarkColor, kind: 'text' })
  }
  if (record.daymarkShape !== undefined) {
    daymark.push({ label: 'Shape', value: record.daymarkShape, kind: 'text' })
  }
  pushSection(sections, 'daymark', 'Daymark', daymark)

  const signals: NormalizedItem[] = []
  if (record.soundEmitterType !== undefined) {
    signals.push({ label: 'Sound signal', value: record.soundEmitterType, kind: 'text' })
  }
  if (record.racon !== undefined) {
    signals.push({ label: 'RACON', value: record.racon, kind: 'text' })
  }
  pushSection(sections, 'signals', 'Signals', signals)

  if (record.remark !== undefined && record.remark.length > 0) {
    pushSection(sections, 'remarks', 'Remarks', [
      { label: 'Remark', value: record.remark, kind: 'note' }
    ])
  }

  // Identity and provenance. Always present: every record carries an LLNR,
  // volume, and district. LLNR and Volume are identifiers, not tallies, so they
  // are 'text' rather than 'count' even though the values are numeric.
  const source: NormalizedItem[] = [
    { label: 'LLNR', value: record.llnr, kind: 'text' },
    { label: 'Volume', value: record.volume, kind: 'text' },
    { label: 'District', value: record.district, kind: 'text' }
  ]
  if (record.modifiedDate !== undefined) {
    source.push({ label: 'Last updated', value: record.modifiedDate.slice(0, 10), kind: 'text' })
  }
  if (record.inactive) {
    source.push({ label: 'Inactive', value: true, kind: 'flag' })
  }
  pushSection(sections, 'source', 'Source', source)

  return sections
}
