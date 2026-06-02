/**
 * Tests for the USCG Light List normalized-section builder.
 *
 * The builder turns a structured LightListRecord into the source-agnostic
 * `NormalizedSection[]` a structured client renders, mirroring the same
 * humanized content the HTML renderer shows but as data rather than markup.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLightListSections } from '../src/inputs/uscg-light-list/light-list-sections.js'
import type { LightListRecord } from '../src/inputs/uscg-light-list/light-list-types.js'
import type { NormalizedSection } from '../src/shared/normalized-detail.js'

function record (overrides: Partial<LightListRecord>): LightListRecord {
  return {
    llnr: 40100,
    name: 'Whipple Point Light',
    position: { latitude: 42.0, longitude: -71.0 },
    district: 'D01',
    volume: 1,
    source: 'usclightlist',
    inactive: false,
    ...overrides
  }
}

function section (sections: NormalizedSection[], id: string): NormalizedSection | undefined {
  return sections.find((s) => s.id === id)
}

test('builds normalized sections for a fully populated light, mirroring the humanized detail', () => {
  const sections = buildLightListSections(record({
    lightChar: 'Fl W 4s',
    nominalRange: { value: 14, unit: 'NAUT MI' },
    focalPlane: { value: 67, unit: 'FT' },
    structureType: 'White tower on cylindrical base',
    structureHeight: { value: 28, unit: 'FT' },
    daymarkShape: 'square',
    daymarkColor: 'red',
    soundEmitterType: 'HORN',
    racon: 'B',
    remark: 'Visible 015° to 195°',
    modifiedDate: '2024-03-12T00:00:00.000Z'
  }))

  assert.deepEqual(section(sections, 'light')?.items, [
    { label: 'Character', value: 'flashing, white, 4 s period', kind: 'text' },
    { label: 'Nominal range', value: 14, kind: 'measure', unit: 'NM' },
    { label: 'Focal plane', value: 67, kind: 'measure', unit: 'ft' }
  ])
  assert.deepEqual(section(sections, 'structure')?.items, [
    { label: 'Type', value: 'White tower on cylindrical base', kind: 'text' },
    { label: 'Height', value: 28, kind: 'measure', unit: 'ft' }
  ])
  assert.deepEqual(section(sections, 'daymark')?.items, [
    { label: 'Color', value: 'red', kind: 'text' },
    { label: 'Shape', value: 'square', kind: 'text' }
  ])
  assert.deepEqual(section(sections, 'signals')?.items, [
    { label: 'Sound signal', value: 'HORN', kind: 'text' },
    { label: 'RACON', value: 'B', kind: 'text' }
  ])
  assert.deepEqual(section(sections, 'remarks')?.items, [
    { label: 'Remark', value: 'Visible 015° to 195°', kind: 'note' }
  ])
  assert.deepEqual(section(sections, 'source')?.items, [
    { label: 'LLNR', value: 40100, kind: 'count' },
    { label: 'Volume', value: 1, kind: 'count' },
    { label: 'District', value: 'D01', kind: 'text' },
    { label: 'Last updated', value: '2024-03-12', kind: 'text' }
  ])
})

test('omits empty sections and flags an inactive daymark-only aid', () => {
  const sections = buildLightListSections(record({
    daymarkShape: 'square',
    daymarkColor: 'red',
    inactive: true
  }))
  assert.equal(section(sections, 'light'), undefined, 'no light fields means no Light section')
  assert.equal(section(sections, 'structure'), undefined)
  assert.equal(section(sections, 'signals'), undefined)
  assert.equal(section(sections, 'remarks'), undefined)
  assert.ok(section(sections, 'daymark') !== undefined)
  // The source section always carries identity, and gains an Inactive flag.
  const source = section(sections, 'source')
  assert.ok(source?.items.some((i) => i.label === 'Inactive' && i.value === true && i.kind === 'flag'))
})
