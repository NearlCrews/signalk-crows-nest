/**
 * Tests for the OpenSeaMap normalized-section builder.
 *
 * The builder turns an Overpass element into the source-agnostic
 * `NormalizedSection[]` a structured client renders, mirroring the same
 * curated, humanized content the HTML detail renderer shows but as data
 * rather than markup. The two read the same tags through the same helpers,
 * so the structured values match the rendered description.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOpenSeaMapSections } from '../src/inputs/openseamap/openseamap-sections.js'
import type { OverpassElement } from '../src/inputs/openseamap/overpass-client.js'
import type { NormalizedSection } from '../src/shared/normalized-detail.js'

function element (overrides: Partial<OverpassElement> = {}): OverpassElement {
  return {
    type: 'node',
    id: 123,
    tags: {},
    position: { latitude: 42.0, longitude: -71.0 },
    ...overrides
  }
}

function section (sections: NormalizedSection[], id: string): NormalizedSection | undefined {
  return sections.find((s) => s.id === id)
}

test('builds normalized sections for a tag-rich lateral buoy with a light, mirroring the curated detail', () => {
  const sections = buildOpenSeaMapSections(element({
    tags: {
      'seamark:type': 'buoy_lateral',
      name: 'Channel Marker 3',
      'seamark:buoy_lateral:category': 'port_hand',
      'seamark:buoy_lateral:colour': 'red',
      'seamark:buoy_lateral:shape': 'can',
      'seamark:light:character': 'Fl(2)',
      'seamark:light:colour': 'red',
      'seamark:light:period': '6',
      'seamark:light:range': '4',
      'seamark:light:height': '3.5',
      'seamark:light:exhibition': 'night_only',
      'seamark:information': 'Maintained by the harbour authority.',
      'seamark:notice': 'Do not pass on the landward side.'
    }
  }))

  assert.deepEqual(section(sections, 'feature')?.items, [
    { label: 'Category', value: 'port hand', kind: 'text' },
    { label: 'Colour', value: 'red', kind: 'text' },
    { label: 'Shape', value: 'can', kind: 'text' }
  ])
  assert.deepEqual(section(sections, 'light')?.items, [
    { label: 'Character', value: 'flashing (2)', kind: 'text' },
    { label: 'Colour', value: 'red', kind: 'text' },
    { label: 'Period', value: 6, kind: 'measure', unit: 's' },
    { label: 'Range', value: 4, kind: 'measure', unit: 'NM' },
    { label: 'Height', value: 3.5, kind: 'measure', unit: 'm' },
    { label: 'Exhibition', value: 'night only', kind: 'text' }
  ])
  assert.deepEqual(section(sections, 'notes')?.items, [
    { label: 'Information', value: 'Maintained by the harbour authority.', kind: 'note' },
    { label: 'Notice', value: 'Do not pass on the landward side.', kind: 'note' }
  ])
})

test('omits empty sections for a sparse element with no curated tags', () => {
  const sections = buildOpenSeaMapSections(element({
    tags: { 'seamark:type': 'rock' }
  }))
  assert.equal(section(sections, 'feature'), undefined, 'no family tags means no Feature section')
  assert.equal(section(sections, 'light'), undefined, 'no light tags means no Light section')
  assert.equal(section(sections, 'notes'), undefined, 'no prose tags means no Notes section')
  assert.equal(sections.length, 0, 'a bare element yields no sections at all')
})

test('keeps a non-numeric light measure as text rather than dropping it', () => {
  const sections = buildOpenSeaMapSections(element({
    tags: {
      'seamark:type': 'light_minor',
      'seamark:light:period': 'continuous'
    }
  }))
  assert.deepEqual(section(sections, 'light')?.items, [
    { label: 'Period', value: 'continuous', kind: 'text' }
  ])
})
