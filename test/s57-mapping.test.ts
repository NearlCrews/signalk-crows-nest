/**
 * Tests for the S-57 enum lookup tables and per-layer PoiType/skIcon mappings
 * used by the NOAA ENC Direct detail renderer.
 *
 * The live ENC Direct ArcGIS service pre-decodes some S-57 fields to strings
 * and leaves others as numeric codes. The wire shapes the mapping module
 * actually receives, verified against live `MapServer/<id>/query` responses
 * for the wreck, obstruction, and rock layers:
 *
 *  - CATWRK and CATOBS are decoded strings, e.g. `"dangerous wreck"`,
 *    `"foul ground"`, or a blank `" "` when not categorized. A numeric
 *    lookup table would never match, so the module humanizes them.
 *  - WATLEV is a JSON number, e.g. `3` (`always submerged`).
 *  - QUASOU is a single-digit JSON string, e.g. `"6"` (`least depth known`).
 *  - TECSOU is a single-digit JSON string, e.g. `"2"` (`found by side-scan
 *    sonar`); frequently `null`.
 *  - Many other optional fields ship as JSON `null`, not as missing keys, so
 *    `lookupCode` and `humanizeCategory` both treat `null` and `undefined`
 *    identically.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  layerPoiType,
  layerSkIcon,
  humanizeCategory,
  lookupCode,
  WATLEV,
  QUASOU,
  TECSOU
} from '../src/inputs/noaa-enc/s57-mapping.js'

test('every ENC hazard layer maps to PoiType Hazard and the hazard skIcon', () => {
  assert.equal(layerPoiType('wreck'), 'Hazard')
  assert.equal(layerPoiType('obstruction'), 'Hazard')
  assert.equal(layerPoiType('rock'), 'Hazard')
  assert.equal(layerSkIcon('wreck'), 'hazard')
  assert.equal(layerSkIcon('obstruction'), 'hazard')
  assert.equal(layerSkIcon('rock'), 'hazard')
})

test('humanizeCategory passes pre-decoded wire strings through, trimmed', () => {
  assert.equal(humanizeCategory('dangerous wreck'), 'dangerous wreck')
  assert.equal(humanizeCategory(' foul ground '), 'foul ground')
  assert.equal(humanizeCategory('non-dangerous wreck (test)'), 'non-dangerous wreck (test)')
})

test('humanizeCategory returns undefined for null, undefined, blank, and non-strings', () => {
  assert.equal(humanizeCategory(null), undefined)
  assert.equal(humanizeCategory(undefined), undefined)
  assert.equal(humanizeCategory(' '), undefined)
  assert.equal(humanizeCategory(''), undefined)
  assert.equal(humanizeCategory(42), undefined)
})

test('WATLEV table covers the IHO S-57 water-level codes', () => {
  assert.equal(WATLEV[3], 'always submerged')
  assert.equal(WATLEV[5], 'awash')
  assert.equal(WATLEV[2], 'always dry')
  assert.equal(WATLEV[4], 'covers and uncovers')
})

test('QUASOU and TECSOU tables carry the codes observed on the live wire', () => {
  assert.equal(QUASOU[6], 'least depth known')
  assert.equal(QUASOU[1], 'depth known')
  assert.equal(TECSOU[2], 'found by side-scan sonar')
  assert.equal(TECSOU[6], 'swept by wire-drag')
})

test('lookupCode reads JSON numbers and string-of-digit values', () => {
  assert.equal(lookupCode(WATLEV, 3), 'always submerged')
  assert.equal(lookupCode(QUASOU, '6'), 'least depth known')
  assert.equal(lookupCode(TECSOU, '2'), 'found by side-scan sonar')
})

test('lookupCode treats null, undefined, blank string, and unknown codes as absent', () => {
  assert.equal(lookupCode(WATLEV, null), undefined)
  assert.equal(lookupCode(WATLEV, undefined), undefined)
  assert.equal(lookupCode(WATLEV, ''), undefined)
  assert.equal(lookupCode(WATLEV, ' '), undefined)
  assert.equal(lookupCode(WATLEV, 999), undefined)
  assert.equal(lookupCode(QUASOU, 'not a number'), undefined)
})
