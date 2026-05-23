/**
 * Tests for the NOAA ENC Direct plain-English detail renderer.
 *
 * The inputs to the renderer match the wire shapes the ArcGIS service
 * actually produces (verified live against the wreck, obstruction, and rock
 * layers at the coastal scale band): CATWRK and CATOBS are decoded strings,
 * WATLEV is a number, QUASOU and TECSOU are single-digit strings, OBJNAM is
 * often `null`, and many other optional fields ship as JSON `null`. The
 * renderer must skip null fields, never write the word `null`, and surface
 * the layer label when OBJNAM is absent.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { renderEncDirectDetail } from '../src/inputs/noaa-enc/enc-direct-detail.js'

test('renders a dangerous-wreck record with charted depth and survey technique', () => {
  const html = renderEncDirectDetail('wreck', {
    CATWRK: 'dangerous wreck',
    WATLEV: 3,
    VALSOU: 23.7,
    SOUACC: 0.5,
    QUASOU: '6',
    TECSOU: '2',
    INFORM: 'Iron-hulled steamer',
    OBJNAM: 'SS Portland',
    SORDAT: '200705',
    DSNM: 'US5MA12M.000'
  })
  assert.ok(html.includes('SS Portland'))
  assert.ok(html.includes('dangerous wreck'))
  assert.ok(html.includes('always submerged'))
  assert.ok(html.includes('23.7 m'))
  assert.ok(html.includes('±0.5 m'))
  assert.ok(html.includes('side-scan sonar'))
  assert.ok(html.includes('least depth known'))
  assert.ok(html.includes('Iron-hulled steamer'))
  assert.ok(html.includes('US5MA12M.000'))
  assert.ok(html.includes('2007-05'))
  assert.ok(html.includes('not intended for primary navigation'))
})

test('renders an unnamed obstruction with the layer label as a fallback header', () => {
  const html = renderEncDirectDetail('obstruction', {
    CATOBS: 'foul ground',
    WATLEV: 3,
    VALSOU: 8.2,
    OBJNAM: null
  })
  assert.ok(html.includes('Obstruction'))
  assert.ok(html.includes('foul ground'))
  assert.ok(html.includes('always submerged'))
  assert.ok(html.includes('8.2 m'))
})

test('renders a rock with only WATLEV as a short note', () => {
  const html = renderEncDirectDetail('rock', { WATLEV: 5 })
  assert.ok(html.includes('Rock'))
  assert.ok(html.includes('awash'))
  assert.ok(html.includes('not intended for primary navigation'))
})

test('formats an eight-digit SORDAT (YYYYMMDD) with the day preserved', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test Wreck',
    SORDAT: '20060915',
    DSNM: 'US3NY1AE.000'
  })
  assert.ok(html.includes('2006-09-15'))
})

test('formats a six-digit SORDAT (YYYYMM) without inventing a day', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test Wreck',
    SORDAT: '201206',
    DSNM: 'US3NY1AE.000'
  })
  assert.ok(html.includes('2012-06'))
  assert.ok(!html.includes('2012-06-'))
})

test('labels the SORDAT date as "surveyed", not "last updated"', () => {
  // SORDAT is the hydrographic survey date (often decades old for a stable
  // feature), not the chart-refresh date. "Surveyed YYYY-MM" reads correctly
  // for old surveys; "last updated YYYY-MM" misleads operators into thinking
  // NOAA stopped maintaining the chart.
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test Wreck',
    SORDAT: '200403',
    DSNM: 'US3NY1AE.000'
  })
  assert.ok(html.includes('surveyed 2004-03'),
    'the source line uses the "surveyed" label')
  assert.ok(!html.includes('last updated'),
    'the misleading "last updated" label does not slip back in')
})

test('treats null property values as absent and never writes the word null', () => {
  const html = renderEncDirectDetail('wreck', {
    CATWRK: 'dangerous wreck',
    CONRAD: null,
    CONVIS: null,
    EXPSOU: 1,
    HEIGHT: null,
    OBJNAM: null,
    QUASOU: '6',
    SOUACC: null,
    TECSOU: null,
    VALSOU: 20.1,
    VERACC: null,
    VERDAT: null,
    VERLEN: null,
    WATLEV: 3,
    INFORM: null,
    SCAMIN: null,
    SORDAT: '201206',
    SORIND: 'US,US,graph,Chart 12300',
    DSNM: 'US3NY1AE.000'
  })
  assert.ok(html.includes('Wreck'))
  assert.ok(html.includes('dangerous wreck'))
  assert.ok(html.includes('always submerged'))
  assert.ok(html.includes('20.1 m'))
  assert.ok(html.includes('least depth known'))
  assert.ok(!html.toLowerCase().includes('null'))
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('NaN'))
})

test('omits the Survey technique line when TECSOU is null', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test', WATLEV: 3, TECSOU: null
  })
  assert.ok(!html.includes('Survey technique'))
})

test('omits the Charted depth line when VALSOU is null', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test', WATLEV: 3, VALSOU: null
  })
  assert.ok(!html.includes('Charted depth'))
})

test('omits the sounding-accuracy parenthetical when SOUACC is null', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test', VALSOU: 12.0, SOUACC: null
  })
  assert.ok(html.includes('12 m'))
  assert.ok(!html.includes('sounding accuracy'))
})

test('skips the Source line when DSNM is null', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test', WATLEV: 3, DSNM: null, SORDAT: null
  })
  assert.ok(!html.includes('<strong>Source:</strong>'))
})

test('skips a blank CATOBS placeholder (the wire emits a single space)', () => {
  const html = renderEncDirectDetail('obstruction', {
    OBJNAM: null,
    CATOBS: ' ',
    WATLEV: 3,
    VALSOU: 24
  })
  // The header should fall back to "Obstruction" with a watlev suffix only.
  assert.ok(html.includes('Obstruction (always submerged)'))
})

test('escapes HTML in INFORM so a stray tag cannot inject markup', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: 'Test',
    INFORM: '<script>alert(1)</script>'
  })
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('escapes HTML in OBJNAM so a stray tag cannot inject markup', () => {
  const html = renderEncDirectDetail('wreck', {
    OBJNAM: '<img src=x>'
  })
  assert.ok(html.includes('&lt;img'))
  assert.ok(!html.includes('<img'))
})
