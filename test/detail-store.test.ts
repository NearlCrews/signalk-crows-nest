import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDetailStore, type DetailStoreOptions } from '../src/shared/detail-store.js'

/** A minimal stored value type, with a matching guard, for the generic store. */
interface Widget {
  n: number
  label: string
}

function isWidget (value: unknown): value is Widget {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const widget = value as { n?: unknown, label?: unknown }
  return typeof widget.n === 'number' && typeof widget.label === 'string'
}

const STORE_FILE_NAME = 'widget-cache.json'

/** Generous retention so entries never expire mid-test unless a test forces it. */
const RETENTION_MINUTES = 60

/** Build a widget store over `dir`, with optional overrides. */
function makeStore (dir: string, overrides: Partial<DetailStoreOptions<Widget>> = {}): ReturnType<typeof createDetailStore<Widget>> {
  return createDetailStore<Widget>({
    directoryPath: dir,
    fileName: STORE_FILE_NAME,
    isValue: isWidget,
    retentionMinutes: RETENTION_MINUTES,
    ...overrides
  })
}

/** Run a test body with a fresh temporary directory, removed afterwards. */
function withTempDir (body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'detail-store-'))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('persisted entries survive into a fresh store instance', () => {
  withTempDir((dir) => {
    const writer = makeStore(dir)
    writer.persist('a', { n: 1, label: 'first' })
    writer.persist('b', { n: 2, label: 'second' })
    writer.flush()

    const loaded = makeStore(dir).load()

    assert.equal(Object.keys(loaded).length, 2)
    assert.deepEqual(loaded.a?.value, { n: 1, label: 'first' })
    assert.deepEqual(loaded.b?.value, { n: 2, label: 'second' })
    assert.equal(typeof loaded.a?.timestamp, 'number')
  })
})

test('persist replaces an existing entry rather than duplicating it', () => {
  withTempDir((dir) => {
    const store = makeStore(dir)
    store.persist('a', { n: 1, label: 'first' })
    store.persist('a', { n: 1, label: 'renamed' })
    store.flush()

    const loaded = makeStore(dir).load()

    assert.equal(Object.keys(loaded).length, 1)
    assert.equal(loaded.a?.value.label, 'renamed')
  })
})

test('replaceAll removes entries absent from the authoritative snapshot', () => {
  withTempDir((dir) => {
    const store = makeStore(dir)
    store.persist('old', { n: 1, label: 'old' })
    store.replaceAll(new Map([
      ['current', { n: 2, label: 'current' }]
    ]))
    store.flush()

    const loaded = makeStore(dir).load()
    assert.deepEqual(Object.keys(loaded), ['current'])
    assert.equal(loaded.current?.value.label, 'current')
  })
})

test('load drops entries older than the retention window and keeps fresh ones', () => {
  withTempDir((dir) => {
    const now = Date.now()
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify({
      version: 1,
      entries: {
        stale: { timestamp: now - 90 * 60_000, value: { n: 1, label: 'stale' } },
        fresh: { timestamp: now - 5 * 60_000, value: { n: 2, label: 'fresh' } }
      }
    }))

    const loaded = makeStore(dir).load()

    assert.equal(Object.keys(loaded).length, 1, 'the 90-minute-old entry should be dropped')
    assert.ok('fresh' in loaded)
    assert.ok(!('stale' in loaded))
  })
})

test('load returns an empty map when the store file is missing', () => {
  withTempDir((dir) => {
    assert.equal(Object.keys(makeStore(dir).load()).length, 0)
  })
})

test('load survives a corrupt store file and starts empty', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, STORE_FILE_NAME), '{ not valid json')
    assert.equal(Object.keys(makeStore(dir).load()).length, 0)
  })
})

test('load ignores a readable file of the wrong shape', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify({ unexpected: true }))
    assert.equal(Object.keys(makeStore(dir).load()).length, 0)
  })
})

test('load ignores a file whose version does not match', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify({
      version: 2,
      entries: { a: { timestamp: Date.now(), value: { n: 1, label: 'first' } } }
    }))
    // The store defaults to version 1, so a version-2 file is discarded rather
    // than mis-hydrated.
    assert.equal(Object.keys(makeStore(dir).load()).length, 0)
  })
})

test('load drops entries whose value fails the caller guard but keeps valid ones', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify({
      version: 1,
      entries: {
        good: { timestamp: Date.now(), value: { n: 1, label: 'first' } },
        badNumber: { timestamp: 'not-a-number', value: { n: 2, label: 'second' } },
        badValue: { timestamp: Date.now(), value: { n: 'three', label: 'third' } },
        emptyValue: { timestamp: Date.now(), value: {} }
      }
    }))

    const loaded = makeStore(dir).load()

    assert.equal(Object.keys(loaded).length, 1, 'only the structurally valid entry survives')
    assert.ok('good' in loaded)
  })
})

test('clear removes the store file and any leftover temp sibling', () => {
  withTempDir((dir) => {
    const store = makeStore(dir)
    store.persist('a', { n: 1, label: 'first' })
    store.flush()
    // Simulate a `.tmp` sibling left behind by a failed rename.
    const tempPath = join(dir, `${STORE_FILE_NAME}.tmp`)
    writeFileSync(tempPath, '{}', 'utf8')

    store.clear()

    assert.equal(existsSync(join(dir, STORE_FILE_NAME)), false, 'the store file is removed')
    assert.equal(existsSync(tempPath), false, 'the leftover temp file is removed too')
    assert.equal(Object.keys(makeStore(dir).load()).length, 0)
  })
})

test('persist creates the data directory when it does not yet exist', () => {
  withTempDir((dir) => {
    const nested = join(dir, 'does', 'not', 'exist')
    const store = makeStore(nested)

    assert.doesNotThrow(() => { store.persist('a', { n: 1, label: 'first' }) })
    store.flush()
    assert.equal(Object.keys(makeStore(nested).load()).length, 1)
  })
})

test('persist defers the file write until flush', () => {
  withTempDir((dir) => {
    const store = makeStore(dir)
    store.persist('a', { n: 1, label: 'first' })
    assert.ok(!existsSync(join(dir, STORE_FILE_NAME)), 'the write is debounced')

    store.flush()
    assert.ok(existsSync(join(dir, STORE_FILE_NAME)))
    assert.equal(Object.keys(makeStore(dir).load()).length, 1)
  })
})

test('flush is a no-op when no write is pending', () => {
  withTempDir((dir) => {
    assert.doesNotThrow(() => { makeStore(dir).flush() })
  })
})

test('a write prunes the oldest entries past the maxEntries cap', () => {
  withTempDir((dir) => {
    const now = Date.now()
    // Two pre-existing entries with distinct ages, plus a cap of 2. A third
    // persist pushes the total to 3, so the next write drops the oldest.
    writeFileSync(join(dir, STORE_FILE_NAME), JSON.stringify({
      version: 1,
      entries: {
        oldest: { timestamp: now - 2000, value: { n: 1, label: 'oldest' } },
        middle: { timestamp: now - 1000, value: { n: 2, label: 'middle' } }
      }
    }))

    const store = makeStore(dir, { maxEntries: 2 })
    store.load()
    store.persist('newest', { n: 3, label: 'newest' })
    store.flush()

    const onDisk = JSON.parse(readFileSync(join(dir, STORE_FILE_NAME), 'utf8'))
    assert.deepEqual(Object.keys(onDisk.entries).sort(), ['middle', 'newest'],
      'the oldest entry is pruned when the cap is exceeded')
  })
})
