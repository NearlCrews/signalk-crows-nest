import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPoiStore } from '../src/inputs/active-captain/poi-store.js'
import type { PoiDetails } from '../src/inputs/active-captain/active-captain-types.js'

/** Generous TTL so entries never expire mid-test unless a test forces it. */
const TTL_MINUTES = 60

/** File name the store persists to, matching the poiStore implementation. */
const STORE_FILE_NAME = 'poi-cache.json'

/** Build a minimal but valid PoiDetails record for the given id. */
function makeDetails (id: string): PoiDetails {
  return {
    pointOfInterest: {
      id: Number(id),
      name: `POI ${id}`,
      poiType: 'Marina',
      mapLocation: { latitude: 0, longitude: 0 },
      dateLastModified: '2024-01-01T00:00:00Z'
    }
  }
}

/** Run a test body with a fresh temporary directory, removed afterwards. */
function withTempDir (body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'poi-store-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('clear removes a leftover temp file alongside the store file', () => {
  withTempDir((dir) => {
    const store = createPoiStore(dir, TTL_MINUTES)
    store.persist('1', makeDetails('1'))
    store.flush()
    // Simulate a `.tmp` sibling left behind by a failed rename. clear() must
    // remove it too, so a wipe leaves no debris for the next run to trip over.
    const tempPath = join(dir, `${STORE_FILE_NAME}.tmp`)
    writeFileSync(tempPath, '{}', 'utf8')
    store.clear()
    assert.equal(existsSync(join(dir, STORE_FILE_NAME)), false, 'the store file is removed')
    assert.equal(existsSync(tempPath), false, 'the leftover temp file is removed too')
  })
})

test('persisted entries survive into a fresh store instance', () => {
  withTempDir((dir) => {
    const writer = createPoiStore(dir, TTL_MINUTES)
    writer.persist('1', makeDetails('1'))
    writer.persist('2', makeDetails('2'))
    writer.flush()

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 2)
    assert.equal(loaded.get('1')?.details.pointOfInterest.name, 'POI 1')
    assert.equal(loaded.get('2')?.details.pointOfInterest.name, 'POI 2')
    assert.equal(typeof loaded.get('1')?.timestamp, 'number')
  })
})

test('persist replaces an existing entry rather than duplicating it', () => {
  withTempDir((dir) => {
    const store = createPoiStore(dir, TTL_MINUTES)
    store.persist('1', makeDetails('1'))
    const replacement = makeDetails('1')
    replacement.pointOfInterest.name = 'Renamed POI'
    store.persist('1', replacement)
    store.flush()

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 1)
    assert.equal(loaded.get('1')?.details.pointOfInterest.name, 'Renamed POI')
  })
})

test('load drops entries older than the TTL window and keeps fresh ones', () => {
  withTempDir((dir) => {
    const now = Date.now()
    const fileContents = {
      version: 1,
      entries: {
        stale: { timestamp: now - 90 * 60_000, details: makeDetails('1') },
        fresh: { timestamp: now - 5 * 60_000, details: makeDetails('2') }
      }
    }
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify(fileContents))

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 1, 'the 90-minute-old entry should be dropped')
    assert.ok(loaded.has('fresh'))
    assert.ok(!loaded.has('stale'))
  })
})

test('load returns an empty map when the store file is missing', () => {
  withTempDir((dir) => {
    const loaded = createPoiStore(dir, TTL_MINUTES).load()
    assert.equal(loaded.size, 0)
  })
})

test('load survives a corrupt store file and starts empty', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, STORE_FILE_NAME), '{ this is not valid json')

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 0)
  })
})

test('load ignores a readable file of the wrong shape', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify({ unexpected: true }))

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 0)
  })
})

test('load drops individual malformed entries but keeps valid ones', () => {
  withTempDir((dir) => {
    const fileContents = {
      version: 1,
      entries: {
        good: { timestamp: Date.now(), details: makeDetails('1') },
        bad: { timestamp: 'not-a-number', details: makeDetails('2') }
      }
    }
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify(fileContents))

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 1)
    assert.ok(loaded.has('good'))
  })
})

test('load drops an entry whose details are structurally incomplete', () => {
  withTempDir((dir) => {
    // `details` is an object, so a shallow check would accept it, but it has
    // no `pointOfInterest`: hydrating it would crash getResource later.
    const fileContents = {
      version: 1,
      entries: {
        good: { timestamp: Date.now(), details: makeDetails('1') },
        empty: { timestamp: Date.now(), details: {} },
        partial: { timestamp: Date.now(), details: { pointOfInterest: {} } }
      }
    }
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify(fileContents))

    const loaded = createPoiStore(dir, TTL_MINUTES).load()

    assert.equal(loaded.size, 1, 'only the structurally complete entry survives')
    assert.ok(loaded.has('good'))
  })
})

test('clear empties the store and removes the backing file', () => {
  withTempDir((dir) => {
    const store = createPoiStore(dir, TTL_MINUTES)
    store.persist('1', makeDetails('1'))
    store.flush()
    assert.ok(existsSync(join(dir, STORE_FILE_NAME)))

    store.clear()

    assert.ok(!existsSync(join(dir, STORE_FILE_NAME)))
    assert.equal(createPoiStore(dir, TTL_MINUTES).load().size, 0)
  })
})

test('clear is a no-op when nothing has been persisted', () => {
  withTempDir((dir) => {
    assert.doesNotThrow(() => { createPoiStore(dir, TTL_MINUTES).clear() })
  })
})

test('persist creates the data directory when it does not yet exist', () => {
  withTempDir((dir) => {
    const nested = join(dir, 'does', 'not', 'exist')
    const store = createPoiStore(nested, TTL_MINUTES)

    assert.doesNotThrow(() => { store.persist('1', makeDetails('1')) })
    store.flush()
    assert.equal(createPoiStore(nested, TTL_MINUTES).load().size, 1)
  })
})

test('persist defers the file write until flush', () => {
  withTempDir((dir) => {
    const store = createPoiStore(dir, TTL_MINUTES)
    store.persist('1', makeDetails('1'))
    // The write is debounced, so nothing has reached disk yet.
    assert.ok(!existsSync(join(dir, STORE_FILE_NAME)))

    store.flush()
    assert.ok(existsSync(join(dir, STORE_FILE_NAME)))
    assert.equal(createPoiStore(dir, TTL_MINUTES).load().size, 1)
  })
})

test('flush is a no-op when no write is pending', () => {
  withTempDir((dir) => {
    assert.doesNotThrow(() => { createPoiStore(dir, TTL_MINUTES).flush() })
  })
})

test('a stale entry is pruned from disk on the next persist', () => {
  withTempDir((dir) => {
    const now = Date.now()
    const fileContents = {
      version: 1,
      entries: {
        stale: { timestamp: now - 90 * 60_000, details: makeDetails('1') }
      }
    }
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify(fileContents))

    const store = createPoiStore(dir, TTL_MINUTES)
    store.load() // drops the stale entry from the in-memory mirror
    store.persist('2', makeDetails('2'))
    store.flush()

    const onDisk = JSON.parse(readFileSync(join(dir, STORE_FILE_NAME), 'utf8'))
    assert.deepEqual(Object.keys(onDisk.entries), ['2'])
  })
})
