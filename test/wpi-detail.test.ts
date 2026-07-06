/**
 * Tests for the World Port Index HTML detail renderer.
 *
 * The renderer must surface the decoded classification, restrictions, metric
 * depths, and services, skip every absent field rather than print a
 * placeholder, and HTML-escape wire strings so a hostile port name cannot
 * inject markup.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { renderWpiDetail } from '../src/inputs/wpi/wpi-detail.js'
import type { WpiPort } from '../src/inputs/wpi/wpi-types.js'

const brooklyn: WpiPort = {
  portNumber: 7630,
  portName: 'Brooklyn',
  countryName: 'United States',
  xcoord: -74.0167,
  ycoord: 40.6667,
  harborSize: 'L',
  harborType: 'RN',
  shelter: 'E',
  erTide: 'N',
  erOther: 'Y',
  overheadLimits: 'Y',
  chDepth: '13',
  anDepth: '13',
  tide: 2,
  ptCompulsory: 'Y',
  tugsAssist: 'Y',
  repairCode: 'A',
  drydock: 'M',
  suFuel: 'Y',
  suDiesel: 'Y',
  chartNumber: '12334',
  navArea: 'IV'
}

test('renderWpiDetail surfaces the decoded classification, depths, and services', () => {
  const html = renderWpiDetail(brooklyn)
  assert.ok(html.includes('<h4>Brooklyn, United States</h4>'))
  assert.ok(html.includes('Large'))
  assert.ok(html.includes('River, natural'))
  assert.ok(html.includes('Excellent'))
  // Metric depth is formatted at the display edge with one decimal.
  assert.ok(html.includes('Channel depth:</strong> 13.0 m'))
  assert.ok(html.includes('Tidal range:</strong> 2.0 m'))
  assert.ok(html.includes('Other')) // entrance restriction summary
  assert.ok(html.includes('Compulsory'))
  assert.ok(html.includes('Major')) // repairs
  assert.ok(html.includes('Fuel oil, Diesel')) // supplies list
})

test('renderWpiDetail skips absent fields rather than printing a placeholder', () => {
  const sparse: WpiPort = { portNumber: 9, portName: 'Sparse', xcoord: 1, ycoord: 1 }
  const html = renderWpiDetail(sparse)
  assert.equal(html, '<h4>Sparse</h4>')
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('null'))
})

test('renderWpiDetail escapes HTML in wire strings', () => {
  const hostile: WpiPort = {
    portNumber: 5,
    portName: '<script>alert(1)</script>',
    xcoord: 1,
    ycoord: 1
  }
  const html = renderWpiDetail(hostile)
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})
