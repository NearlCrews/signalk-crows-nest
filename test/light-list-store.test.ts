import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

test('store falls back to an empty index when index.json is the wrong shape', async () => {
  // A future format version, a hand-edited backup, or a half-written file
  // would otherwise crash Object.values(undefined) on the next list query.
  // The store accepts the file as JSON, sees it does not carry the records
  // and districts properties, and starts empty.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    await mkdir(join(dir, 'uscg-light-list'), { recursive: true })
    await writeFile(join(dir, 'uscg-light-list', 'index.json'), '{}', 'utf8')
    const index = await createLightListStore(dir).load()
    assert.deepEqual(index.records, {})
    assert.deepEqual(index.districts, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store falls back to an empty index when index.json is unparseable', async () => {
  // A truncated write or a power-cycle mid-flush leaves invalid JSON on disk;
  // a failed parse should not block the plugin from starting.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    await mkdir(join(dir, 'uscg-light-list'), { recursive: true })
    await writeFile(join(dir, 'uscg-light-list', 'index.json'), '{not valid json', 'utf8')
    const index = await createLightListStore(dir).load()
    assert.deepEqual(index.records, {})
    assert.deepEqual(index.districts, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('closing during a flush prevents dirty data from committing to disk', async () => {
  // flush() has already started when close() runs. The commit-time lifecycle
  // check must still prevent this stopped run from publishing its index.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D01', 1, [sampleRecord(100)], {}) // marks the page dirty
    const flushing = store.flush()
    store.close()
    await flushing
    assert.equal(
      existsSync(join(dir, 'uscg-light-list', 'index.json')), false,
      'a stopped store does not commit an in-flight flush'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('queryBbox returns records inside the bbox using the spatial tile index', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D01', 1, [
      sampleRecord(100), // (42, -71): inside the New England bbox below
      { ...sampleRecord(200), position: { latitude: 25, longitude: -80 } } // off New England
    ], {})
    const inside = store.queryBbox({ south: 41, west: -72, north: 43, east: -70 })
    assert.equal(inside.length, 1)
    assert.equal(inside[0].llnr, 100)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('queryBbox returns records on both sides of an antimeridian-crossing bbox', async () => {
  // A vessel near the western Aleutians (D17, an active Light List
  // district) gets a bbox whose `east < west` because it wraps the
  // 180/-180 meridian. queryBbox must split the longitude range into two
  // and return records from both halves; the naive single-range loop
  // returned zero hits, hiding every aid on the very stretch the data is
  // meant for.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D17', 1, [
      { ...sampleRecord(800, 'D17'), position: { latitude: 52, longitude: 179 } },
      { ...sampleRecord(801, 'D17'), position: { latitude: 52, longitude: -179 } },
      { ...sampleRecord(802, 'D17'), position: { latitude: 52, longitude: 0 } } // far away
    ], {})
    const wrap = store.queryBbox({ south: 51, west: 178, north: 53, east: -178 })
    const llnrs = wrap.map(r => r.llnr).sort()
    assert.deepEqual(llnrs, [800, 801])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('queryBbox finds a record at exactly longitude 180 across an antimeridian bbox', async () => {
  // A record at +180 lands in the highest longitude cell. The tile key must
  // clamp that cell into range; otherwise it collides with the next latitude
  // row's cell 0 and a wrap (antimeridian) query, whose longitude range stops
  // at the last in-range cell, never visits it, silently dropping the aid.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D17', 1, [
      { ...sampleRecord(810, 'D17'), position: { latitude: 52, longitude: 180 } }
    ], {})
    // A narrow latitude band that holds the record's own tile row but NOT the
    // row the unclamped +180 cell aliases into (lonCell 3600 == next row's
    // cell 0). With the wide band the alias row is visited and masks the bug.
    const wrap = store.queryBbox({ south: 51.95, west: 178, north: 52.05, east: -178 })
    assert.deepEqual(wrap.map(r => r.llnr), [810])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('load tolerates a district meta missing llnrs/recordCount without wedging later upserts', async () => {
  // A corrupt, truncated, or hand-edited index.json can carry a district
  // entry missing llnrs/recordCount. load must not crash, and the next
  // refresh upsert of that district must not throw: the old code dereferenced
  // previous.llnrs unguarded, threw per page, and (since the throw aborted
  // before the page was marked dirty) repeated every refresh, permanently
  // wedging the source until the data dir was wiped.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    await mkdir(join(dir, 'uscg-light-list'), { recursive: true })
    await writeFile(
      join(dir, 'uscg-light-list', 'index.json'),
      JSON.stringify({ generated: 'x', districts: { D01_1: { fetchedAt: 'x' } } }),
      'utf8'
    )
    const store = createLightListStore(dir)
    await assert.doesNotReject(store.load())
    assert.doesNotThrow(() => store.upsertDistrict('D01', 1, [sampleRecord(100)], {}))
    const hit = store.queryBbox({ south: 41, west: -72, north: 43, east: -70 })
    assert.deepEqual(hit.map(r => r.llnr), [100], 'the store self-heals: the new record is queryable')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('recordCount reflects the live in-memory record total, not stale per-district counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store = createLightListStore(dir)
    await store.load()
    store.upsertDistrict('D01', 1, [sampleRecord(100), sampleRecord(101)], {})
    store.upsertDistrict('D05', 1, [sampleRecord(500, 'D05')], {})
    assert.equal(store.recordCount(), 3)
    // A re-upsert that shrinks a district is reflected at once, so the
    // source's cacheSize cannot over-report after a partial-decode recovery.
    store.upsertDistrict('D01', 1, [sampleRecord(100)], {})
    assert.equal(store.recordCount(), 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('load drops cached conditional-GET headers when the page file is missing', async () => {
  // A district whose metadata is persisted but whose page file is missing
  // or unreadable was previously a permanent 304 dark zone: the cached
  // lastModified/etag kept NAVCEN replying 304 and the records stayed
  // missing forever. After load, those headers must be cleared so the
  // next refresh forces a 200 OK.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store1 = createLightListStore(dir)
    await store1.load()
    store1.upsertDistrict('D01', 1, [sampleRecord(100)], {
      lastModified: 'Thu, 22 May 2026 09:26:29 GMT',
      etag: '"abc"'
    })
    await store1.flush()
    // Simulate the failure: blank out the page file but leave metadata
    // alone. (rm + create empty is the simplest reproduction.)
    await writeFile(join(dir, 'uscg-light-list', 'pages', 'D01_1.json'), '[]', 'utf8')
    const store2 = createLightListStore(dir)
    const reloaded = await store2.load()
    // The metadata for the district is preserved so the source still
    // knows the page exists; the conditional-GET headers are cleared.
    assert.ok(reloaded.districts.D01_1 !== undefined)
    assert.equal(reloaded.districts.D01_1.lastModified, undefined)
    assert.equal(reloaded.districts.D01_1.etag, undefined)
    // The cleared metadata is flushed to disk.
    await store2.flush()
    const reloaded2 = await createLightListStore(dir).load()
    assert.equal(reloaded2.districts.D01_1.etag, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('load repairs same-size page and metadata disagreement', async () => {
  // A multi-file flush can commit a page immediately before close vetoes the
  // metadata commit. The page and metadata can then have the same count but
  // different LLNRs. Load must adopt the page LLNRs and clear validators so a
  // later upsert removes the right old records and forces a complete refresh.
  const dir = await mkdtemp(join(tmpdir(), 'll-store-'))
  try {
    const store1 = createLightListStore(dir)
    await store1.load()
    store1.upsertDistrict('D01', 1, [sampleRecord(100)], {
      lastModified: 'Thu, 22 May 2026 09:26:29 GMT',
      etag: '"abc"'
    })
    await store1.flush()
    await writeFile(
      join(dir, 'uscg-light-list', 'pages', 'D01_1.json'),
      JSON.stringify([sampleRecord(200)]),
      'utf8'
    )

    const store2 = createLightListStore(dir)
    const reloaded = await store2.load()
    assert.deepEqual(reloaded.districts.D01_1.llnrs, [200])
    assert.equal(reloaded.districts.D01_1.lastModified, undefined)
    assert.equal(reloaded.districts.D01_1.etag, undefined)

    store2.upsertDistrict('D01', 1, [sampleRecord(300)], {})
    assert.equal(reloaded.records['200'], undefined)
    assert.equal(reloaded.records['300']?.llnr, 300)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
