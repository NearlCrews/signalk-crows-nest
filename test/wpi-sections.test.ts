/**
 * Tests for the World Port Index normalized-section builder.
 *
 * The builder emits the same attributes the HTML renderer does, but as
 * structured items: depths and vessel sizes as metric `measure` items, coded
 * classifications as `text`, and yes/no facilities as `flag`. Empty sections
 * must be dropped so a sparse port yields a short structure.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWpiSections } from '../src/inputs/wpi/wpi-sections.js'
import type { NormalizedSection } from '../src/shared/normalized-detail.js'
import type { WpiPort } from '../src/inputs/wpi/wpi-types.js'

function sectionById (sections: NormalizedSection[], id: string): NormalizedSection | undefined {
  return sections.find((section) => section.id === id)
}

const rich: WpiPort = {
  portNumber: 7630,
  portName: 'Brooklyn',
  xcoord: -74.0167,
  ycoord: 40.6667,
  harborSize: 'L',
  harborType: 'RN',
  shelter: 'E',
  overheadLimits: 'Y',
  erIce: 'Y',
  chDepth: '13',
  tide: 2,
  maxVesselLength: '295',
  ptCompulsory: 'Y',
  medFacilities: 'Y',
  suWater: 'Y',
  chartNumber: '12334'
}

test('buildWpiSections builds the harbor, depths, and services sections', () => {
  const sections = buildWpiSections(rich)
  const harbor = sectionById(sections, 'harbor')
  assert.ok(harbor !== undefined)
  assert.deepEqual(
    harbor.items.find((item) => item.label === 'Size'),
    { label: 'Size', value: 'Large', kind: 'text' }
  )

  const depths = sectionById(sections, 'depths')
  assert.ok(depths !== undefined)
  assert.deepEqual(
    depths.items.find((item) => item.label === 'Channel depth'),
    { label: 'Channel depth', value: 13, kind: 'measure', unit: 'm' }
  )

  const vessel = sectionById(sections, 'vessel')
  assert.deepEqual(
    vessel?.items.find((item) => item.label === 'Length'),
    { label: 'Length', value: 295, kind: 'measure', unit: 'm' }
  )

  const services = sectionById(sections, 'services')
  assert.deepEqual(
    services?.items.find((item) => item.label === 'Pilotage compulsory'),
    { label: 'Pilotage compulsory', value: true, kind: 'flag' }
  )

  const restrictions = sectionById(sections, 'restrictions')
  assert.deepEqual(
    restrictions?.items.find((item) => item.label === 'Entrance restrictions'),
    { label: 'Entrance restrictions', value: 'Ice', kind: 'text' }
  )
})

test('buildWpiSections drops empty sections for a sparse port', () => {
  const sparse: WpiPort = { portNumber: 9, portName: 'Sparse', xcoord: 1, ycoord: 1 }
  const sections = buildWpiSections(sparse)
  // Every section is all-absent, so none survive.
  assert.deepEqual(sections, [])
})
