import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLightListStore } from '../src/inputs/uscg-light-list/light-list-store.js'
import type { LightListRecord } from '../src/inputs/uscg-light-list/light-list-types.js'

function sampleRecord (llnr: number, district = 'D01'): LightListRecord {
  return {
    llnr,
    name: `Light ${llnr}`,
    position: { latitude: 42.0, longitude: -71.0 },
    district,
    volume: 1,
    source: 'usclightlist',
    inactive: false
  }
}

test('store reads an empty index on cold start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    const index = await store.load()
    assert.equal(Object.keys(index.records).length, 0)
    assert.equal(Object.keys(index.districts).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store round-trips a district write and reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store1 = createLightListStore(dir)
    await store1.load()
    store1.upsertDistrict('D01', 1, [sampleRecord(100), sampleRecord(101)], {
      lastModified: 'Thu, 22 May 2026 09:26:29 GMT',
      etag: '"abc"'
    })
    await store1.flush()
    const store2 = createLightListStore(dir)
    const reloaded = await store2.load()
    assert.equal(Object.keys(reloaded.records).length, 2)
    assert.equal(reloaded.records['100'].name, 'Light 100')
    assert.equal(reloaded.districts.D01_1.recordCount, 2)
    assert.equal(
      reloaded.districts.D01_1.lastModified,
      'Thu, 22 May 2026 09:26:29 GMT'
    )
    assert.equal(reloaded.districts.D01_1.etag, '"abc"')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store replaces a district on re-upsert (no record bleed)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D01', 1, [sampleRecord(100), sampleRecord(101)], {})
    store.upsertDistrict('D01', 1, [sampleRecord(200)], {})
    await store.flush()
    const reloaded = await createLightListStore(dir).load()
    // Records 100 and 101 should be gone; only 200 remains under D01_1.
    assert.equal(reloaded.records['100'], undefined)
    assert.equal(reloaded.records['101'], undefined)
    assert.equal(reloaded.records['200'].llnr, 200)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store keeps records from other districts when one district is re-upserted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D01', 1, [sampleRecord(100)], {})
    store.upsertDistrict('D05', 1, [sampleRecord(500, 'D05')], {})
    // Re-upsert D01_1 with a new record set.
    store.upsertDistrict('D01', 1, [sampleRecord(101)], {})
    await store.flush()
    const reloaded = await createLightListStore(dir).load()
    // D05's record survives; D01's previous record is replaced.
    assert.equal(reloaded.records['500'].llnr, 500)
    assert.equal(reloaded.records['100'], undefined)
    assert.equal(reloaded.records['101'].llnr, 101)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
