/**
 * Tests for the panel's own source-name map, which answers for a source the
 * status snapshot does not carry a row for.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { SOURCE_NAMES, isSourceSlug, sourceDisplayName } from '../src/panel/source-names.js'
import { SOURCE_SLUGS } from '../src/shared/source-ids.js'

test('every source the plugin knows has a panel name', () => {
  for (const slug of SOURCE_SLUGS) {
    assert.equal(typeof SOURCE_NAMES[slug], 'string')
    assert.notEqual(SOURCE_NAMES[slug], '')
  }
  assert.equal(Object.keys(SOURCE_NAMES).length, SOURCE_SLUGS.length)
})

test('the snapshot name wins where the snapshot has one', () => {
  assert.equal(sourceDisplayName('openseamap', 'OpenSeaMap'), 'OpenSeaMap')
  // The plugin's shorter names are what an operator sees in the status table,
  // so the button beside it should not disagree.
  assert.equal(sourceDisplayName('noaaenc', 'NOAA ENC Direct'), 'NOAA ENC Direct')
})

test('a source with no status row falls back to the panel name, not the slug', () => {
  // plugin-status.ts records an error against a source that failed before it
  // registered, which left the jump button reading "Show openseamap".
  assert.equal(sourceDisplayName('openseamap'), 'OpenSeaMap')
  assert.equal(sourceDisplayName('openseamap', ''), 'OpenSeaMap')
})

test('a slug neither side knows survives as itself rather than disappearing', () => {
  assert.equal(sourceDisplayName('not-a-source'), 'not-a-source')
  assert.equal(isSourceSlug('not-a-source'), false)
  assert.equal(isSourceSlug('openseamap'), true)
})
