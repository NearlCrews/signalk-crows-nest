/**
 * Tests for the translation between per-layer boolean flags and the shared
 * CheckboxGroup's value array.
 *
 * The group reports its whole selection on every change, while the reducer
 * has one action per layer, so the translation must fire exactly the actions
 * whose layer actually flipped: a missed flip would leave a layer stuck, and
 * an extra one would dispatch (and re-render) for no change.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { applySelectedValues, selectedValues, type ValueToggle } from '../src/panel/checkbox-group-value.js'

function toggles (checked: Record<string, boolean>, calls: string[]): ValueToggle[] {
  return Object.entries(checked).map(([value, isChecked]) => ({
    value,
    label: value,
    checked: isChecked,
    onChange: (next) => calls.push(`${value}=${String(next)}`)
  }))
}

test('selectedValues lists the checked toggles in toggle order', () => {
  const list = toggles({ wrecks: true, obstructions: false, rocks: true }, [])
  assert.deepEqual(selectedValues(list), ['wrecks', 'rocks'])
})

test('selectedValues is empty when nothing is checked', () => {
  assert.deepEqual(selectedValues(toggles({ locks: false, dams: false }, [])), [])
})

test('applySelectedValues fires onChange only for toggles whose membership changed', () => {
  const calls: string[] = []
  const list = toggles({ wrecks: true, obstructions: true, rocks: false }, calls)
  // Wrecks stays on, obstructions turns off, rocks turns on.
  applySelectedValues(list, ['wrecks', 'rocks'])
  assert.deepEqual(calls, ['obstructions=false', 'rocks=true'])
})

test('applySelectedValues fires nothing when the selection already matches', () => {
  const calls: string[] = []
  applySelectedValues(toggles({ tide: true, current: false }, calls), ['tide'])
  assert.deepEqual(calls, [])
})

test('applySelectedValues clears every checked toggle for an empty selection', () => {
  const calls: string[] = []
  applySelectedValues(toggles({ locks: true, dams: true }, calls), [])
  assert.deepEqual(calls, ['locks=false', 'dams=false'])
})
