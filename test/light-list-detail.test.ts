/**
 * Tests for the plain-English HTML renderer for a USCG Light List record.
 *
 * The wire format carries USCG-specific abbreviations and unit codes that
 * mean nothing on a chart popup; the renderer humanizes them, escapes any
 * HTML in the free-text remark, and reuses the OpenSeaMap IALA light-character
 * humanizer.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { renderLightListDetail } from '../src/inputs/uscg-light-list/light-list-detail.js'
import type { LightListRecord } from '../src/inputs/uscg-light-list/light-list-types.js'

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

test('renders a major light with all common fields humanized', () => {
  const html = renderLightListDetail(record({
    lightChar: 'Fl W 4s',
    nominalRange: { value: 14, unit: 'NAUT MI' },
    focalPlane: { value: 67, unit: 'FT' },
    structureType: 'White tower on cylindrical base',
    structureHeight: { value: 28, unit: 'FT' },
    soundEmitterType: 'HORN',
    racon: 'B',
    remark: 'Visible 015° to 195°'
  }))
  assert.ok(html.includes('Whipple Point Light'))
  assert.ok(html.includes('LLNR 40100'))
  assert.ok(html.includes('flashing'))
  assert.ok(html.includes('white'))
  assert.ok(html.includes('14 NM range'))
  assert.ok(html.includes('67 ft focal plane'))
  assert.ok(html.includes('White tower on cylindrical base'))
  assert.ok(html.includes('HORN'))
  assert.ok(html.includes('RACON'))
  assert.ok(html.includes('B'))
  assert.ok(html.includes('Visible 015° to 195°'))
})

test('renders an inactive aid with an "(inactive)" suffix in the header', () => {
  const html = renderLightListDetail(record({ inactive: true }))
  assert.ok(html.includes('(inactive)'))
})

test('escapes HTML in REMARK so a stray tag cannot inject markup', () => {
  const html = renderLightListDetail(record({ remark: '<script>alert(1)</script>' }))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('renders a daymark-only entry without a Light: line', () => {
  const html = renderLightListDetail(record({
    daymarkShape: 'square',
    daymarkColor: 'red'
  }))
  assert.ok(html.includes('Daymark'))
  assert.ok(!html.includes('<strong>Light:</strong>'))
})

test('renders the clean integer volume (not a zero-padded string)', () => {
  const html = renderLightListDetail(record({ volume: 1, district: 'D01' }))
  assert.ok(html.includes('Volume 1'))
  assert.ok(html.includes('District D01'))
})

test('a light character that humanizes to nothing renders no Light line', () => {
  // A bare `Light: .` once shipped onto the chart, in the screenshot the
  // package publishes, because the line decided emptiness from which fields
  // were present rather than from what the line would render. Whitespace-only
  // is the surviving way a present field still contributes nothing: it
  // tokenizes to a single empty token.
  for (const lightChar of ['', '   ', '\t\n']) {
    const html = renderLightListDetail(record({ lightChar }))
    assert.ok(
      !html.includes('<strong>Light:</strong>'),
      `a lightChar of ${JSON.stringify(lightChar)} must not render a Light line`
    )
    assert.ok(!html.includes('Light:</strong> .'), 'no bare label and period')
  }
})

test('a light character that humanizes to nothing still renders its range and focal plane', () => {
  // The empty part drops out; the line itself survives on what is left, so an
  // aid with a usable range does not lose it to an unusable character.
  const html = renderLightListDetail(record({
    lightChar: '   ',
    nominalRange: { value: 14, unit: 'NAUT MI' }
  }))
  assert.ok(html.includes('<strong>Light:</strong> 14 NM range.'))
})
