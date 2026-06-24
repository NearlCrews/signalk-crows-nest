/**
 * Tests for the Save button's disabled-state logic.
 *
 * The bug: with a fresh unconfigured plugin, `state` and `savedState` both
 * seed from the same default object, so `dirty` is false at mount and the
 * Save button stayed permanently disabled until the user made a throwaway
 * edit. A user who wanted to enable the plugin with default settings could not.
 *
 * The fix: `saveButtonDisabled` returns false (enabled) when the plugin is
 * unconfigured, regardless of the dirty flag, so the user can save defaults
 * to enable the plugin.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { saveButtonDisabled } from '../src/panel/footer-bar-state.js'

test('saveButtonDisabled is false (Save enabled) when unconfigured and not dirty', () => {
  // Fresh plugin: configuration prop was null/undefined at mount, no edits yet.
  assert.equal(saveButtonDisabled(false, true), false)
})

test('saveButtonDisabled is false (Save enabled) when unconfigured and dirty', () => {
  // Unconfigured plugin with pending edits: still enabled.
  assert.equal(saveButtonDisabled(true, true), false)
})

test('saveButtonDisabled is false (Save enabled) when configured and dirty', () => {
  // Previously saved plugin with pending edits: Save must be enabled.
  assert.equal(saveButtonDisabled(true, false), false)
})

test('saveButtonDisabled is true (Save disabled) when configured and not dirty', () => {
  // Previously saved plugin with no pending edits: nothing to save.
  assert.equal(saveButtonDisabled(false, false), true)
})
