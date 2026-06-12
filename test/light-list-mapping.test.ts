/**
 * Tests for the USCG Light List PoiType and Freeboard-icon mapping.
 *
 * Every Light List entry is a navigation aid, so PoiType is always
 * `Navigational`. The Freeboard icon is `navigation-structure` by default;
 * isolated-danger AtoNs get the hazard glyph (matching the existing
 * OpenSeaMap pattern), and inactive aids get the notice-to-mariners glyph.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIGHT_LIST_POI_TYPE,
  recordSkIcon,
  isIsolatedDanger
} from '../src/inputs/uscg-light-list/light-list-mapping.js'
import type { LightListRecord } from '../src/inputs/uscg-light-list/light-list-types.js'

function record (overrides: Partial<LightListRecord>): LightListRecord {
  return {
    llnr: 1,
    name: 'X',
    position: { latitude: 0, longitude: 0 },
    district: 'D01',
    volume: 1,
    source: 'usclightlist',
    inactive: false,
    ...overrides
  }
}

test('every Light List record maps to PoiType Navigational', () => {
  assert.equal(LIGHT_LIST_POI_TYPE, 'Navigational')
})

test('default skIcon is navigation-structure', () => {
  assert.equal(recordSkIcon(record({ aidType: 'FD/FX' })), 'navigation-structure')
  assert.equal(recordSkIcon(record({})), 'navigation-structure')
})

test('isolated-danger aids resolve to the hazard skIcon', () => {
  const r = record({ aidSubtype: 'ISO/DG' })
  assert.equal(isIsolatedDanger(r), true)
  assert.equal(recordSkIcon(r), 'hazard')
})

test('isolated-danger from REMARK text also resolves to the hazard skIcon', () => {
  const r = record({ remark: 'Isolated danger mark' })
  assert.equal(isIsolatedDanger(r), true)
  assert.equal(recordSkIcon(r), 'hazard')
})

test('inactive aids fall back to the notice-to-mariners skIcon', () => {
  const r = record({ aidType: 'FD/FX', inactive: true })
  assert.equal(recordSkIcon(r), 'notice-to-mariners')
})
