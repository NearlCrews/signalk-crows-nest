/**
 * Tests for the tri-state select-all derivation used by SelectAllCheckbox.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAllState, selectAllTarget } from '../src/panel/select-all-state.js'

test('all toggles on renders checked, not indeterminate', () => {
  assert.deepEqual(selectAllState(4, 4), { checked: true, indeterminate: false })
})

test('no toggles on renders unchecked, not indeterminate', () => {
  assert.deepEqual(selectAllState(0, 4), { checked: false, indeterminate: false })
})

test('a partial selection renders indeterminate', () => {
  assert.deepEqual(selectAllState(1, 4), { checked: false, indeterminate: true })
  assert.deepEqual(selectAllState(3, 4), { checked: false, indeterminate: true })
})

test('an empty group renders unchecked, never checked', () => {
  assert.deepEqual(selectAllState(0, 0), { checked: false, indeterminate: false })
})

test('clicking completes a partial or empty selection', () => {
  assert.equal(selectAllTarget(0, 4), true)
  assert.equal(selectAllTarget(3, 4), true)
})

test('clicking a fully-selected group clears it', () => {
  assert.equal(selectAllTarget(4, 4), false)
})
