/**
 * Tests for the NOAA CO-OPS station mapping: PoiType, skIcon, labels, the
 * internal resource id, and the tidesandcurrents.noaa.gov station-page URLs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COOPS_POI_TYPE,
  COOPS_SK_ICON,
  coopsInternalId,
  stationPageUrl,
  stationTypeLabel
} from '../src/inputs/noaa-coops/coops-mapping.js'
import type { CoopsStationRecord } from '../src/inputs/noaa-coops/noaa-coops-types.js'

function tideStation (overrides: Partial<CoopsStationRecord> = {}): CoopsStationRecord {
  return {
    id: '8447386',
    stationType: 'tide',
    name: 'Fall River',
    position: { latitude: 41.7043, longitude: -71.1641 },
    source: 'noaacoops',
    ...overrides
  }
}

test('every station maps to the Navigational PoiType and the navigation-structure icon', () => {
  assert.equal(COOPS_POI_TYPE, 'Navigational')
  assert.equal(COOPS_SK_ICON, 'navigation-structure')
})

test('stationTypeLabel names each family', () => {
  assert.equal(stationTypeLabel('tide'), 'Tide station')
  assert.equal(stationTypeLabel('current'), 'Current station')
})

test('coopsInternalId prefixes the raw id with the station type', () => {
  assert.equal(coopsInternalId({ stationType: 'tide', id: '8447386' }), 'tide_8447386')
  assert.equal(coopsInternalId({ stationType: 'current', id: 'bh0101' }), 'current_bh0101')
})

test('stationPageUrl resolves the tide station home page', () => {
  const url = stationPageUrl(tideStation())
  assert.equal(url, 'https://tidesandcurrents.noaa.gov/stationhome.html?id=8447386')
})

test('stationPageUrl resolves the current predictions page', () => {
  const url = stationPageUrl(tideStation({ stationType: 'current', id: 'bh0101' }))
  assert.equal(url, 'https://tidesandcurrents.noaa.gov/noaacurrents/Predictions?id=bh0101')
})

test('stationPageUrl percent-encodes the raw id', () => {
  const url = stationPageUrl(tideStation({ id: 'a b' }))
  assert.equal(url, 'https://tidesandcurrents.noaa.gov/stationhome.html?id=a%20b')
})
