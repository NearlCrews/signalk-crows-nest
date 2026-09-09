/**
 * Contract test for loading the shared UI package from this CommonJS test
 * suite.
 *
 * `signalk-nearlcrews-ui` ships ES modules only. Its export map declares a
 * `default` condition beside `import`, so Node's `require(esm)` (Node 20.19
 * and 22.12 or newer) resolves the entry and this suite can reach the
 * package's pure utilities and constants. Earlier releases carried only an
 * `import` condition, and a node-tested module could not touch the package at
 * all; this test fails loudly, at the import, if that regresses, rather than
 * leaving a future helper to discover it. It also pins the installed package
 * to the version `package.json` names, so a stale `node_modules` cannot pass
 * the suite against a different release than the panel bundles.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatRelativeAgeSince, PACKAGE_VERSION } from 'signalk-nearlcrews-ui'
import { resolveSaveActionBarState } from 'signalk-nearlcrews-ui/composites'

const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  devDependencies: Record<string, string>
}

test('the installed shared UI is the exact version package.json pins', () => {
  assert.equal(PACKAGE_VERSION, manifest.devDependencies['signalk-nearlcrews-ui'])
})

test('the root entry exposes the relative-age formatter the panel renders ages with', () => {
  // A fresh timestamp reads as a word rather than "0 sec. ago": the panel
  // relies on that default for its freshness notes.
  const now = Date.parse('2026-08-12T16:00:00Z')
  assert.equal(formatRelativeAgeSince(now, now), 'now')
  assert.equal(formatRelativeAgeSince(now - 5 * 60_000, now), '5 minutes ago')
})

test('the composites entry exposes the save bar rules the panel footer follows', () => {
  // A configured, clean plugin has nothing to save; an unconfigured one can
  // save its defaults. Both rules used to live in this repository.
  const labels = {
    clean: 'clean',
    discard: 'discard',
    save: 'save',
    saving: 'saving',
    unconfigured: 'unconfigured',
    unsaved: 'unsaved'
  }
  const shared = { invalidMessage: null, labels, savedMessage: 'saved', saveRequestedAt: null, saving: false }
  assert.equal(resolveSaveActionBarState({ ...shared, dirty: false, unconfigured: false }).saveDisabled, true)
  assert.equal(resolveSaveActionBarState({ ...shared, dirty: false, unconfigured: true }).saveDisabled, false)
  assert.equal(resolveSaveActionBarState({ ...shared, dirty: true, unconfigured: false }).saveDisabled, false)
})
