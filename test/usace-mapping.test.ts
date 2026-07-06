/**
 * Tests for the USACE mapping, detail renderer, and section builder.
 *
 * The lock and dam property bags mirror the live ArcGIS wire (PMSNAME carrying
 * an ampersand, dimensions in feet, a null CITY, opaque single-character
 * codes) so the renderers are exercised against the same shapes production
 * handles.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAYER_LABEL,
  LAYER_POI_TYPE,
  LAYER_SK_ICON,
  structureName
} from '../src/inputs/usace/usace-mapping.js'
import { renderUsaceDetail } from '../src/inputs/usace/usace-detail.js'
import { buildUsaceSections } from '../src/inputs/usace/usace-sections.js'
import type { UsaceFeature } from '../src/inputs/usace/usace-types.js'

const lockProps: Record<string, unknown> = {
  OBJECTID: 203,
  PMSNAME: 'MONTGOMERY LOCK & DAM',
  RIVER: 'OHIO',
  RIVERMI: 31.7,
  LENGTH: 600,
  WIDTH: 110,
  LIFT: 18,
  GATETYPE: 'Miter',
  YEAROPEN: 1936,
  STATE: 'PA',
  STATUS: '1',
  OPER1: '1'
}

const damProps: Record<string, unknown> = {
  OBJECTID: 64270,
  NAME: 'Pine Hollow Detention',
  RIVER_OR_STREAM: 'TR OHIO RIVER',
  CITY: null,
  STATE: 'Pennsylvania',
  PRIMARY_PURPOSE: 'Flood Risk Reduction',
  PRIMARY_DAM_TYPE: 'Earth',
  DAM_HEIGHT: 22,
  DAM_LENGTH: 75,
  YEAR_COMPLETED: 1999,
  HAZARD_POTENTIAL: 'Significant',
  CONDITION_ASSESSMENT: 'Satisfactory',
  PRIMARY_OWNER_TYPE: 'Local Government'
}

test('the per-layer maps resolve to the Lock and Dam PoiTypes and their registered icons', () => {
  assert.equal(LAYER_POI_TYPE.lock, 'Lock')
  assert.equal(LAYER_POI_TYPE.dam, 'Dam')
  assert.equal(LAYER_SK_ICON.lock, 'lock')
  assert.equal(LAYER_SK_ICON.dam, 'dam')
  assert.equal(LAYER_LABEL.lock, 'Lock')
  assert.equal(LAYER_LABEL.dam, 'Dam')
})

test('structureName reads PMSNAME for a lock and NAME for a dam, rejecting blanks', () => {
  assert.equal(structureName('lock', lockProps), 'MONTGOMERY LOCK & DAM')
  assert.equal(structureName('dam', damProps), 'Pine Hollow Detention')
  assert.equal(structureName('lock', { PMSNAME: '   ' }), undefined)
  assert.equal(structureName('dam', {}), undefined)
})

test('renderUsaceDetail renders a lock with SI chamber dimensions and escapes the name', () => {
  const html = renderUsaceDetail('lock', lockProps)
  assert.match(html, /MONTGOMERY LOCK &amp; DAM/)
  // 600 ft => 182.9 m, 110 ft => 33.5 m, 18 ft => 5.5 m.
  assert.match(html, /182\.9 m long and 33\.5 m wide/)
  assert.match(html, /Lift:<\/strong> 5\.5 m/)
  assert.match(html, /River:<\/strong> OHIO \(mile 31\.7\)/)
  assert.match(html, /Gate type:<\/strong> Miter/)
  assert.match(html, /Opened:<\/strong> 1936/)
  // The opaque single-character STATUS and OPER1 codes are never surfaced.
  assert.doesNotMatch(html, /Status/i)
})

test('renderUsaceDetail renders a dam and skips a null city', () => {
  const html = renderUsaceDetail('dam', damProps)
  assert.match(html, /Pine Hollow Detention/)
  assert.match(html, /Location:<\/strong> Pennsylvania\./)
  assert.match(html, /Purpose:<\/strong> Flood Risk Reduction/)
  assert.match(html, /Dam type:<\/strong> Earth/)
  // 22 ft => 6.7 m, 75 ft => 22.9 m.
  assert.match(html, /Height:<\/strong> 6\.7 m/)
  assert.match(html, /Length:<\/strong> 22\.9 m/)
  assert.match(html, /Hazard potential:<\/strong> Significant/)
  assert.doesNotMatch(html, /null/)
})

test('an unnamed feature falls back to the layer label in the header', () => {
  const html = renderUsaceDetail('lock', { OBJECTID: 1 })
  assert.match(html, /<h4>Lock<\/h4>/)
})

test('buildUsaceSections emits SI measures and drops absent items', () => {
  const feature: UsaceFeature = {
    type: 'Feature',
    id: 203,
    geometry: { type: 'Point', coordinates: [-80.385, 40.648] },
    properties: lockProps
  }
  const sections = buildUsaceSections('lock', feature)
  const chamber = sections.find((s) => s.id === 'chamber')
  assert.ok(chamber !== undefined)
  const length = chamber.items.find((i) => i.label === 'Length')
  assert.ok(length !== undefined)
  assert.equal(length.kind, 'measure')
  assert.equal(length.unit, 'm')
  // 600 ft in meters, exact to the conversion factor.
  assert.ok(Math.abs((length.value as number) - 182.88) < 1e-6)
  const location = sections.find((s) => s.id === 'location')
  assert.ok(location?.items.some((i) => i.label === 'River' && i.value === 'OHIO'))
  // The river mile is a location reference, not a convertible length, so it is
  // a text item (never a `measure` a client would auto-convert).
  const riverMile = location?.items.find((i) => i.label === 'River mile')
  assert.ok(riverMile !== undefined)
  assert.equal(riverMile.kind, 'text')
  assert.equal(riverMile.value, '31.7')
})

test('buildUsaceSections drops an empty section rather than showing an empty heading', () => {
  const feature: UsaceFeature = {
    type: 'Feature',
    id: 5,
    geometry: { type: 'Point', coordinates: [-80, 40] },
    // A dam with only a name: the structure section keeps the name, but the
    // location, safety, and source sections have no items and are omitted.
    properties: { OBJECTID: 5, NAME: 'Bare Dam' }
  }
  const sections = buildUsaceSections('dam', feature)
  assert.deepEqual(sections.map((s) => s.id), ['structure'])
})
