/**
 * Tests for the NOAA ENC Direct normalized-section builder.
 *
 * The builder turns a raw ENC Direct feature (a layer key plus the S-57
 * `properties` bag the ArcGIS service emits) into the source-agnostic
 * `NormalizedSection[]` a structured client renders, mirroring the same S-57
 * attributes and humanized values the HTML renderer surfaces but as data
 * rather than markup. OBJNAM is frequently null and most S-57 fields ship
 * null on a given feature, so the sparse case asserts the null-skipping that
 * keeps an unpopulated feature from emitting empty sections.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNoaaEncSections } from '../src/inputs/noaa-enc/noaa-enc-sections.js'
import type { EncFeature } from '../src/inputs/noaa-enc/enc-direct-types.js'
import type { NormalizedSection } from '../src/shared/normalized-detail.js'

function feature (properties: Record<string, unknown>): EncFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-71.0, 42.0] },
    properties
  }
}

function section (sections: NormalizedSection[], id: string): NormalizedSection | undefined {
  return sections.find((s) => s.id === id)
}

test('builds normalized sections for a property-rich wreck, mirroring the humanized detail', () => {
  const sections = buildNoaaEncSections('wreck', feature({
    OBJNAM: 'USS Example',
    CATWRK: 'dangerous wreck',
    WATLEV: 3,
    VALSOU: 12.3,
    SOUACC: 0.5,
    QUASOU: '6',
    TECSOU: '2',
    INFORM: 'Marked by a buoy.',
    DSNM: 'US5MA12M',
    SORDAT: '20240312'
  }))

  // Feature section: OBJNAM, category (CATWRK humanized), water level (WATLEV).
  assert.deepEqual(section(sections, 'feature')?.items, [
    { label: 'Name', value: 'USS Example', kind: 'text' },
    { label: 'Category', value: 'dangerous wreck', kind: 'text' },
    { label: 'Water level', value: 'always submerged', kind: 'text' }
  ])
  // Depth section: VALSOU sounding (measure, metres) plus sounding accuracy.
  assert.deepEqual(section(sections, 'depth')?.items, [
    { label: 'Charted depth', value: 12.3, kind: 'measure', unit: 'm' },
    { label: 'Sounding accuracy', value: 0.5, kind: 'measure', unit: 'm' }
  ])
  // Quality section: QUASOU position quality and TECSOU survey technique.
  assert.deepEqual(section(sections, 'quality')?.items, [
    { label: 'Position quality', value: 'least depth known', kind: 'text' },
    { label: 'Survey technique', value: 'found by side-scan sonar', kind: 'text' }
  ])
  // Information section: the INFORM free-text note.
  assert.deepEqual(section(sections, 'information')?.items, [
    { label: 'Information', value: 'Marked by a buoy.', kind: 'note' }
  ])
  // Source section: dataset (DSNM) and the surveyed date (SORDAT).
  assert.deepEqual(section(sections, 'source')?.items, [
    { label: 'Dataset', value: 'US5MA12M', kind: 'text' },
    { label: 'Surveyed', value: '2024-03-12', kind: 'text' }
  ])
})

test('uses the obstruction category and the six-character SORDAT precision', () => {
  const sections = buildNoaaEncSections('obstruction', feature({
    CATOBS: 'foul ground',
    DSNM: 'US5MA12M',
    SORDAT: '202403'
  }))
  assert.deepEqual(section(sections, 'feature')?.items, [
    { label: 'Category', value: 'foul ground', kind: 'text' }
  ])
  assert.deepEqual(section(sections, 'source')?.items, [
    { label: 'Dataset', value: 'US5MA12M', kind: 'text' },
    { label: 'Surveyed', value: '2024-03', kind: 'text' }
  ])
})

test('omits empty sections for a sparse, unnamed, uncategorized rock', () => {
  // A rock has no category field, and a feature with only null S-57 fields
  // should emit no sections at all rather than empty headings.
  const sections = buildNoaaEncSections('rock', feature({
    OBJNAM: null,
    CATWRK: null,
    WATLEV: null,
    VALSOU: null,
    SOUACC: null,
    QUASOU: null,
    TECSOU: null,
    INFORM: null,
    DSNM: null,
    SORDAT: null
  }))
  assert.deepEqual(sections, [])
})

test('drops the sounding accuracy when VALSOU is absent', () => {
  // Sounding accuracy is meaningless without a sounding, so SOUACC is only
  // surfaced alongside a present VALSOU, mirroring the HTML renderer.
  const sections = buildNoaaEncSections('wreck', feature({
    SOUACC: 0.5,
    WATLEV: 5
  }))
  assert.equal(section(sections, 'depth'), undefined)
  assert.deepEqual(section(sections, 'feature')?.items, [
    { label: 'Water level', value: 'awash', kind: 'text' }
  ])
})
