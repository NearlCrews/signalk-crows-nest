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
  LAYER_POI_TYPE,
  LAYER_SK_ICON,
  categoryLabel,
  classifyDangerous,
  encDepthLabel,
  humanizeCategory,
  lookupCode,
  lookupParsedCode,
  parseS57Code,
  readNumber,
  formatSordatDisplay,
  sordatToIsoTimestamp,
  WATLEV,
  QUASOU,
  TECSOU
} from '../src/inputs/noaa-enc/s57-mapping.js'

test('every ENC hazard layer maps to PoiType Hazard and the hazard skIcon', () => {
  assert.equal(LAYER_POI_TYPE, 'Hazard')
  assert.equal(LAYER_SK_ICON, 'hazard')
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

test('classifyDangerous reads the decoded CATWRK/CATOBS danger word', () => {
  assert.equal(classifyDangerous('dangerous wreck'), true)
  assert.equal(classifyDangerous('non-dangerous wreck'), false)
  // The hyphen is sometimes a space on the wire; both read as non-dangerous.
  assert.equal(classifyDangerous('non dangerous wreck'), false)
  // Case is normalized before the test.
  assert.equal(classifyDangerous('Dangerous Wreck'), true)
})

test('classifyDangerous returns undefined when no danger word is present', () => {
  // Descriptive categories carry no dangerous/non-dangerous status.
  assert.equal(classifyDangerous('foul ground'), undefined)
  assert.equal(classifyDangerous('wreck showing mast'), undefined)
  assert.equal(classifyDangerous(undefined), undefined)
})

test('parseS57Code reads the wire shapes and rejects non-numbers', () => {
  assert.equal(parseS57Code('6'), 6)
  assert.equal(parseS57Code(7), 7)
  assert.equal(parseS57Code(null), undefined)
  assert.equal(parseS57Code(undefined), undefined)
  assert.equal(parseS57Code(' '), undefined)
  assert.equal(parseS57Code('not a number'), undefined)
  assert.equal(parseS57Code('6junk'), undefined)
  assert.equal(parseS57Code('6.5'), undefined)
  assert.equal(parseS57Code(6.5), undefined)
})

test('SORDAT parsing rejects non-digits and impossible calendar dates', () => {
  assert.equal(formatSordatDisplay('20x401'), undefined)
  assert.equal(formatSordatDisplay('20230229'), undefined)
  assert.equal(formatSordatDisplay('20240229'), '2024-02-29')
  assert.equal(sordatToIsoTimestamp('20240229'), '2024-02-29T00:00:00.000Z')
})

test('lookupParsedCode indexes a table with an already-parsed code', () => {
  assert.equal(lookupParsedCode(QUASOU, 6), 'least depth known')
  assert.equal(lookupParsedCode(WATLEV, 3), 'always submerged')
  assert.equal(lookupParsedCode(QUASOU, undefined), undefined)
  assert.equal(lookupParsedCode(QUASOU, 999), undefined)
})

test('encDepthLabel says Least depth for a least-depth code, else Charted depth, both MLLW', () => {
  // QUASOU 6 (least depth known) and 7 (least depth unknown but safe to depth
  // shown) both mean the value is the LEAST depth over the feature. The helper
  // takes the parsed code, so callers parse QUASOU once.
  assert.equal(encDepthLabel(6), 'Least depth (MLLW)')
  assert.equal(encDepthLabel(7), 'Least depth (MLLW)')
  assert.equal(encDepthLabel(1), 'Charted depth (MLLW)')
  assert.equal(encDepthLabel(undefined), 'Charted depth (MLLW)')
})

test('categoryLabel reads CATWRK for a wreck, CATOBS for an obstruction, none for a rock', () => {
  assert.equal(categoryLabel('wreck', { CATWRK: 'dangerous wreck' }), 'dangerous wreck')
  assert.equal(categoryLabel('obstruction', { CATOBS: 'foul ground' }), 'foul ground')
  assert.equal(categoryLabel('rock', { CATWRK: 'dangerous wreck' }), undefined)
  assert.equal(categoryLabel('wreck', { CATWRK: null }), undefined)
})

test('readNumber returns finite numbers and treats null and non-numbers as absent', () => {
  assert.equal(readNumber(12.3), 12.3)
  assert.equal(readNumber(null), undefined)
  assert.equal(readNumber('nope'), undefined)
})
