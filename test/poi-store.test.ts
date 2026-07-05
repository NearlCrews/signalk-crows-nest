import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPoiStore } from '../src/inputs/active-captain/poi-store.js'
import { makeDetails, withTempDir } from './helpers.js'

// The store mechanism (debounced atomic writes, retention, pruning, corrupt-file
// resilience) is covered generically in detail-store.test.ts. These tests cover
// only what the ActiveCaptain binding adds: the PoiDetails guard, the file
// name, and the version-2 discard of the legacy `details`-field format.

/** Generous TTL so entries never expire mid-test unless a test forces it. */
const TTL_MINUTES = 60

/** File name the store persists to, matching the poiStore implementation. */
const STORE_FILE_NAME = 'poi-cache.json'

test('persisted entries survive into a fresh store instance', async () => {
  await withTempDir('poi-store-', async (dir) => {
    const writer = createPoiStore(dir, TTL_MINUTES)
    writer.persist('1', makeDetails('1'))
    writer.persist('2', makeDetails('2'))
    writer.flush()

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(Object.keys(loaded).length, 2)
    assert.equal(loaded['1']?.value.pointOfInterest.name, 'POI 1')
    assert.equal(loaded['2']?.value.pointOfInterest.name, 'POI 2')
    assert.equal(typeof loaded['1']?.timestamp, 'number')
  })
})

test('load drops an entry whose details are structurally incomplete', async () => {
  await withTempDir('poi-store-', async (dir) => {
    // `value` is an object, so a shallow check would accept it, but it has
    // no `pointOfInterest`: hydrating it would crash getResource later.
    const fileContents = {
      version: 2,
      entries: {
        good: { timestamp: Date.now(), value: makeDetails('1') },
        empty: { timestamp: Date.now(), value: {} },
        partial: { timestamp: Date.now(), value: { pointOfInterest: {} } }
      }
    }
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify(fileContents))

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(Object.keys(loaded).length, 1, 'only the structurally complete entry survives')
    assert.ok('good' in loaded)
  })
})

test('load discards a legacy version-1 file whose entries used the details field', async () => {
  await withTempDir('poi-store-', async (dir) => {
    const fileContents = {
      version: 1,
      entries: {
        legacy: { timestamp: Date.now(), details: makeDetails('1') }
      }
    }
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify(fileContents))

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(Object.keys(loaded).length, 0, 'the old format is discarded, not mis-hydrated')
  })
})
