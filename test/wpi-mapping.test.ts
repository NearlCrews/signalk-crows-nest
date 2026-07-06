/**
 * Tests for the World Port Index code-to-label mapping helpers.
 *
 * The Pub 150 wire encodes descriptive fields as single letters and as
 * `Y` / `N` / `U` flags, and ships the depth and vessel-size fields as numeric
 * strings while `tide` is a number. These tests pin the decode tables, the
 * flag reader, the metric parser, and the derived restriction and supply
 * lists so a wire-shape change is caught here rather than in a garbled popup.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  availableSupplies,
  drydockLabel,
  entranceRestrictions,
  harborSizeLabel,
  harborTypeLabel,
  harborUseLabel,
  meterValue,
  portDisplayName,
  portName,
  repairsLabel,
  shelterLabel,
  wpiFlag
} from '../src/inputs/wpi/wpi-mapping.js'
import type { WpiPort } from '../src/inputs/wpi/wpi-types.js'

function port (overrides: Partial<WpiPort> = {}): WpiPort {
  return { portNumber: 1, portName: 'Test', xcoord: 0, ycoord: 0, ...overrides }
}

test('harborSizeLabel decodes the size codes and treats unknown as absent', () => {
  assert.equal(harborSizeLabel(port({ harborSize: 'L' })), 'Large')
  assert.equal(harborSizeLabel(port({ harborSize: 'V' })), 'Very small')
  assert.equal(harborSizeLabel(port({ harborSize: 'U' })), undefined)
  assert.equal(harborSizeLabel(port({ harborSize: ' ' })), undefined)
  assert.equal(harborSizeLabel(port({ harborSize: null })), undefined)
})

test('harborTypeLabel decodes the type codes including the obscure TH', () => {
  assert.equal(harborTypeLabel(port({ harborType: 'CN' })), 'Coastal, natural')
  assert.equal(harborTypeLabel(port({ harborType: 'OR' })), 'Open roadstead')
  assert.equal(harborTypeLabel(port({ harborType: 'TH' })), 'Typhoon harbor')
  assert.equal(harborTypeLabel(port({ harborType: 'ZZ' })), undefined)
})

test('shelterLabel, repairsLabel, and drydockLabel decode their codes', () => {
  assert.equal(shelterLabel(port({ shelter: 'E' })), 'Excellent')
  assert.equal(shelterLabel(port({ shelter: 'N' })), 'None')
  assert.equal(repairsLabel(port({ repairCode: 'A' })), 'Major')
  assert.equal(repairsLabel(port({ repairCode: 'U' })), undefined)
  assert.equal(drydockLabel(port({ drydock: 'M' })), 'Medium (201 to 300 m)')
  assert.equal(drydockLabel(port({ drydock: 'N' })), 'None')
})

test('harborUseLabel decodes the decoded values and treats UNK as absent', () => {
  assert.equal(harborUseLabel(port({ harborUse: 'Cargo' })), 'Cargo')
  assert.equal(harborUseLabel(port({ harborUse: 'Mil' })), 'Military')
  assert.equal(harborUseLabel(port({ harborUse: 'UNK' })), undefined)
})

test('wpiFlag reads yes, no, and unknown', () => {
  assert.equal(wpiFlag('Y'), true)
  assert.equal(wpiFlag('y'), true)
  assert.equal(wpiFlag('N'), false)
  assert.equal(wpiFlag('U'), undefined)
  assert.equal(wpiFlag(' '), undefined)
  assert.equal(wpiFlag(null), undefined)
  assert.equal(wpiFlag(undefined), undefined)
})

test('meterValue parses a number or a numeric string and rejects blanks', () => {
  assert.equal(meterValue(13), 13)
  assert.equal(meterValue('13'), 13)
  assert.equal(meterValue('12.5'), 12.5)
  assert.equal(meterValue('  '), undefined)
  assert.equal(meterValue(''), undefined)
  assert.equal(meterValue(null), undefined)
  assert.equal(meterValue('abc'), undefined)
  assert.equal(meterValue(Number.NaN), undefined)
})

test('entranceRestrictions lists only the restricted entrances in Pub 150 order', () => {
  const restricted = port({ erTide: 'Y', erSwell: 'N', erIce: 'Y', erOther: 'U' })
  assert.deepEqual(entranceRestrictions(restricted), ['Tide', 'Ice'])
  assert.deepEqual(entranceRestrictions(port()), [])
})

test('availableSupplies lists only the available supplies in Pub 150 order', () => {
  const supplied = port({ suProvisions: 'Y', suWater: 'Y', suFuel: 'N', suDiesel: 'Y' })
  assert.deepEqual(availableSupplies(supplied), ['Provisions', 'Water', 'Diesel'])
  assert.deepEqual(availableSupplies(port()), [])
})

test('portName falls back to the index number, portDisplayName adds alternate name and country', () => {
  assert.equal(portName(port({ portName: 'Brooklyn' })), 'Brooklyn')
  assert.equal(
    portDisplayName(port({ portName: 'Brooklyn', alternateName: 'New York', countryName: 'United States' })),
    'Brooklyn (New York), United States'
  )
  assert.equal(portDisplayName(port({ portName: 'Brooklyn', countryName: 'United States' })), 'Brooklyn, United States')
  assert.equal(portDisplayName(port({ portName: 'Brooklyn' })), 'Brooklyn')
})
