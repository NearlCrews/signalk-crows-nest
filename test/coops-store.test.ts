/**
 * Tests for the on-disk NOAA CO-OPS store.
 *
 * The store persists the merged station index to a single JSON file, replaces a
 * station type's record set in place, survives a reload, filters by bbox, and
 * no-ops its flush once closed so a torn-down run cannot overwrite a fresh one.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCoopsStore } from '../src/inputs/noaa-coops/coops-store.js'
import type { CoopsStationRecord, CoopsStationType } from '../src/inputs/noaa-coops/noaa-coops-types.js'
import { withTempDir } from './helpers.js'

function station (
  id: string,
  stationType: CoopsStationType,
  latitude: number,
  longitude: number
): CoopsStationRecord {
  return {
    id,
    stationType,
    name: `Station ${id}`,
    position: { latitude, longitude },
    source: 'noaacoops'
  }
}

test('load returns an empty index on a cold start', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    const index = await store.load()
    assert.equal(Object.keys(index.records).length, 0)
    assert.equal(store.recordCount(), 0)
  })
})

test('upsertType persists records that survive a reload', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], { lastModified: 'Mon, 01 Jun 2026 00:00:00 GMT' })
    await store.flush()

    const reopened = createCoopsStore(dir)
    const index = await reopened.load()
    assert.equal(reopened.recordCount(), 1)
    assert.deepEqual(Object.keys(index.records), ['tide_8447386'])
    // The conditional-GET headers round-trip so the next refresh can send them.
    assert.equal(index.types.tide?.lastModified, 'Mon, 01 Jun 2026 00:00:00 GMT')
    assert.equal(index.types.tide?.recordCount, 1)
  })
})

test('the first empty result still persists type metadata and validators', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [], { etag: 'empty-v1' })
    await store.flush()

    const reopened = createCoopsStore(dir)
    const index = await reopened.load()
    assert.equal(reopened.recordCount(), 0)
    assert.equal(index.types.tide?.recordCount, 0)
    assert.equal(index.types.tide?.etag, 'empty-v1')
  })
})

test('tide and current stations coexist and re-upsert replaces only one type', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], {})
    store.upsertType('current', [station('bh0101', 'current', 42.34, -71.01)], {})
    assert.equal(store.recordCount(), 2)

    // Re-upserting the tide type replaces its records and leaves currents intact.
    store.upsertType('tide', [
      station('8443970', 'tide', 42.35, -71.05),
      station('8447435', 'tide', 41.55, -70.62)
    ], {})
    const ids = Object.keys(store.snapshot().records).sort()
    assert.deepEqual(ids, ['current_bh0101', 'tide_8443970', 'tide_8447435'])
  })
})

test('queryBbox returns only stations inside the box', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [
      station('inside', 'tide', 42.0, -71.0),
      station('outside', 'tide', 10.0, 10.0)
    ], {})
    const hits = store.queryBbox({ north: 43, south: 41, east: -70, west: -72 })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, 'inside')
  })
})

test('an identical refetch with changed headers updates the stored headers', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], { etag: 'v1' })
    await store.flush()

    // Overwrite the persisted index with a sentinel. When the headers changed
    // (etag v1→v2) but the content is unchanged, the store still updates its
    // header metadata and marks dirty, so flush overwrites the sentinel.
    const indexPath = join(dir, 'noaa-coops', 'index.json')
    await writeFile(indexPath, 'SENTINEL', 'utf8')

    // The mdapi answers 200 every poll, so the steady state refetches the same
    // station list. A new etag rides along, but the content is unchanged.
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], { etag: 'v2' })
    await store.flush()

    const persisted = await readFile(indexPath, 'utf8')
    assert.notEqual(persisted, 'SENTINEL', 'flush wrote the updated headers')
    assert.equal(store.snapshot().types.tide?.etag, 'v2', 'changed header updates the stored etag')
  })
})

test('an identical refetch with unchanged headers writes nothing', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], { etag: 'v1' })
    await store.flush()

    const indexPath = join(dir, 'noaa-coops', 'index.json')
    await writeFile(indexPath, 'SENTINEL', 'utf8')

    // Same content, same headers: nothing changed, so flush skips the write.
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], { etag: 'v1' })
    await store.flush()

    assert.equal(await readFile(indexPath, 'utf8'), 'SENTINEL', 'flush wrote nothing')
    assert.equal(store.snapshot().types.tide?.etag, 'v1', 'unchanged headers keep the stored etag')
  })
})

test('an identical refetch clears validators omitted by the latest response', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], {
      etag: 'v1',
      lastModified: 'Mon, 01 Jun 2026 00:00:00 GMT'
    })
    await store.flush()

    const indexPath = join(dir, 'noaa-coops', 'index.json')
    await writeFile(indexPath, 'SENTINEL', 'utf8')
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], {})
    await store.flush()

    assert.notEqual(await readFile(indexPath, 'utf8'), 'SENTINEL')
    assert.equal(store.snapshot().types.tide?.etag, undefined)
    assert.equal(store.snapshot().types.tide?.lastModified, undefined)
  })
})

test('a changed refetch rewrites the index', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], { etag: 'v1' })
    await store.flush()

    const indexPath = join(dir, 'noaa-coops', 'index.json')
    await writeFile(indexPath, 'SENTINEL', 'utf8')

    // A second station appears: the set changed, so flush must persist it.
    store.upsertType('tide', [
      station('8447386', 'tide', 41.7, -71.16),
      station('8443970', 'tide', 42.35, -71.05)
    ], { etag: 'v2' })
    await store.flush()

    const reopened = createCoopsStore(dir)
    await reopened.load()
    assert.equal(reopened.recordCount(), 2, 'the changed set was written and reloads')
  })
})

test('closing during a flush prevents the index from committing', async () => {
  await withTempDir('coops-store-', async (dir) => {
    const store = createCoopsStore(dir)
    await store.load()
    store.upsertType('tide', [station('8447386', 'tide', 41.7, -71.16)], {})
    const flushing = store.flush()
    store.close()
    await flushing

    // Nothing was written, so a fresh store loads an empty index.
    const reopened = createCoopsStore(dir)
    await reopened.load()
    assert.equal(reopened.recordCount(), 0)
  })
})
