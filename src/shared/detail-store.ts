/**
 * Disk-backed key-value store of source detail data, generic over the value
 * type.
 *
 * A source persists its fetched detail records to a single JSON file in the
 * plugin data directory so the in-memory detail cache can be hydrated on a cold
 * start, giving the source offline data without a network round-trip. This is
 * the mechanism the ActiveCaptain `poi-store.ts` established, hoisted here so
 * the OpenSeaMap, NOAA ENC, and USACE sources reuse one implementation rather
 * than each copying it. The value type is a type parameter and the caller supplies the
 * `isValue` guard, so the store stays source-agnostic while a hydrated entry is
 * still validated before use.
 *
 * Retention is deliberately long (30 days by default) and INDEPENDENT of any
 * in-memory freshness window: detail records are nearly static (a marina, a
 * wreck, a rock does not move), so an entry past its freshness window is still
 * the best available answer when the vessel is offline. Retention only bounds
 * how long the file keeps growing with places the vessel has left behind.
 *
 * Every read and write is resilient: a missing, unreadable, or corrupt store
 * file never throws to the caller, the store simply behaves as if it were
 * empty. A failed write is swallowed, the entry survives in memory and is
 * re-fetched on a future cold start.
 *
 * Writes are debounced. A `persist` updates the in-memory mirror and schedules
 * one file write a short while later, so a burst of detail loads collapses into
 * a single rewrite rather than rewriting the whole file once per record.
 * `flush` forces a pending write out at once; a source calls it on close so a
 * clean shutdown loses nothing.
 *
 * This module reads and writes the filesystem, so it is node-only and never
 * imported by the browser-bundled panel.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_POI_CACHE_ENTRIES } from './cache.js'
import { MINUTES_PER_DAY, MS_PER_MINUTE } from './time.js'

/**
 * Default on-disk retention, in minutes: 30 days. Entries older than this are
 * dropped on `load`. The window bounds file growth, not data freshness; a
 * source's own in-memory cache decides when an entry is refetched while online.
 */
export const DEFAULT_DETAIL_STORE_RETENTION_MINUTES = 30 * MINUTES_PER_DAY

/**
 * How long, in milliseconds, a `persist` waits before the file write runs. A
 * burst of loads inside this window collapses into one rewrite of the store.
 */
const WRITE_DEBOUNCE_MS = 1000

/** Default on-disk format version, bumped by a caller if its layout changes. */
const DEFAULT_STORE_VERSION = 1

/** One stored detail entry with its age. */
export interface StoredEntry<V> {
  /** Epoch milliseconds at which the entry was persisted. */
  timestamp: number
  /** The cached detail value. */
  value: V
}

/** The on-disk shape of the store file. */
interface StoreFile<V> {
  version: number
  entries: Record<string, StoredEntry<V>>
}

/** Public surface of the persistent detail store. */
export interface DetailStore<V> {
  /**
   * Read the retained entries from disk, keyed by record id. Entries older than
   * the retention window are dropped; a missing or corrupt store file yields an
   * empty record rather than an error. The returned record is the store's own
   * mirror: read it, do not mutate it.
   */
  load: () => Readonly<Record<string, StoredEntry<V>>>
  /**
   * Record (or replace) one entry, stamped with the current time, and schedule
   * a debounced write of the whole store to disk.
   */
  persist: (id: string, value: V) => void
  /** Replace the complete persisted snapshot and schedule one write. */
  replaceAll: (values: ReadonlyMap<string, V>) => void
  /** Write any pending debounced change to disk now. */
  flush: () => void
  /** Drop every persisted entry and remove the backing file. */
  clear: () => void
}

/** Dependencies for {@link createDetailStore}. */
export interface DetailStoreOptions<V> {
  /**
   * Directory the store file lives in, typically the value of the SignalK
   * app's `getDataDirPath()`.
   */
  directoryPath: string
  /** Name of the JSON file the store persists to inside the directory. */
  fileName: string
  /**
   * Narrow an unknown, JSON-parsed value to the stored value type. A hydrated
   * entry that fails this guard is dropped, so a corrupt or wrong-shaped file
   * never yields a value a source would dereference and crash on.
   */
  isValue: (value: unknown) => value is V
  /**
   * How long, in minutes, a persisted entry is retained. Entries older than
   * this are dropped on `load`. Defaults to
   * {@link DEFAULT_DETAIL_STORE_RETENTION_MINUTES}; injectable for tests.
   */
  retentionMinutes?: number
  /**
   * Hard ceiling on entries kept on disk. The oldest entries past the cap are
   * dropped on each write, so a long-running process is bounded, not only the
   * next restart. Defaults to {@link MAX_POI_CACHE_ENTRIES} so the file tracks
   * the in-memory cache's own ceiling.
   */
  maxEntries?: number
  /**
   * On-disk format version. A file whose version does not match is ignored on
   * load, so a source that changes its stored shape bumps this to discard the
   * old file rather than mis-hydrate it. Defaults to {@link DEFAULT_STORE_VERSION}.
   */
  version?: number
}

/**
 * Narrow a parsed value to a {@link StoredEntry} using the caller's value
 * guard.
 */
function isStoredEntry<V> (
  value: unknown,
  isValue: (value: unknown) => value is V
): value is StoredEntry<V> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as { timestamp?: unknown, value?: unknown }
  return typeof entry.timestamp === 'number' && isValue(entry.value)
}

/** Narrow a parsed value to a {@link StoreFile} of the expected version. */
function isStoreFile (value: unknown, version: number): value is StoreFile<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const file = value as { version?: unknown, entries?: unknown }
  return (
    file.version === version &&
    typeof file.entries === 'object' &&
    file.entries !== null
  )
}

/** Create a persistent detail store for one source. */
export function createDetailStore<V> (options: DetailStoreOptions<V>): DetailStore<V> {
  const {
    directoryPath,
    fileName,
    isValue,
    retentionMinutes = DEFAULT_DETAIL_STORE_RETENTION_MINUTES,
    maxEntries = MAX_POI_CACHE_ENTRIES,
    version = DEFAULT_STORE_VERSION
  } = options
  const filePath = join(directoryPath, fileName)
  const retentionMs = retentionMinutes * MS_PER_MINUTE

  // In-memory mirror of the on-disk store, kept current so each persist can
  // rewrite the whole file without re-reading it. Populated by load().
  let entries: Record<string, StoredEntry<V>> = {}

  // A pending debounced write, or undefined when no write is scheduled.
  let writeTimer: NodeJS.Timeout | undefined

  // Writes go to a temp file that is then renamed over the target, so a crash
  // mid-write cannot corrupt the store. The temp path is fixed (no pid), so at
  // most one stale temp file can ever exist; the next write truncates and
  // reuses it. A failed rename unlinks the temp file so a write error does not
  // leave debris behind.
  const tempPath = `${filePath}.tmp`

  // Bound the mirror at the cap by dropping the oldest entries past it. With
  // the long retention this is what keeps a month-long cruise from growing the
  // file, the startup parse, and the hydration loop without limit; pruning
  // happens on each write, so a long-running process is bounded too.
  const pruneToCap = (): void => {
    const ids = Object.keys(entries)
    if (ids.length <= maxEntries) {
      return
    }
    ids.sort((a, b) => entries[a].timestamp - entries[b].timestamp)
    for (const id of ids.slice(0, ids.length - maxEntries)) {
      delete entries[id]
    }
  }

  const writeFile = (): void => {
    pruneToCap()
    const payload: StoreFile<V> = { version, entries }
    mkdirSync(directoryPath, { recursive: true })
    writeFileSync(tempPath, JSON.stringify(payload))
    try {
      renameSync(tempPath, filePath)
    } catch (error) {
      rmSync(tempPath, { force: true })
      throw error
    }
  }

  // Run a pending write now, cancelling the debounce timer. A failed write is
  // swallowed: the entry stays in the in-memory mirror and is re-fetched on a
  // future cold start.
  const flush = (): void => {
    if (writeTimer === undefined) {
      return
    }
    clearTimeout(writeTimer)
    writeTimer = undefined
    try {
      writeFile()
    } catch {
      // A failed write must not crash the plugin.
    }
  }

  return {
    load: (): Readonly<Record<string, StoredEntry<V>>> => {
      entries = {}

      let raw: string
      try {
        raw = readFileSync(filePath, 'utf8')
      } catch {
        // No store file yet (first run), or it cannot be read: start empty.
        return entries
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        // Corrupt JSON: discard the file's contents and start empty.
        return entries
      }

      if (!isStoreFile(parsed, version)) {
        // A readable file of the wrong shape or version: ignore it.
        return entries
      }

      const cutoff = Date.now() - retentionMs
      for (const [id, entry] of Object.entries(parsed.entries)) {
        if (!isStoredEntry<V>(entry, isValue) || entry.timestamp < cutoff) {
          // Malformed, or older than the retention window: drop it.
          continue
        }
        entries[id] = entry
      }
      // The mirror doubles as the result so hydration does not allocate a
      // second copy of up to MAX_POI_CACHE_ENTRIES entries at startup.
      return entries
    },

    persist: (id: string, value: V): void => {
      // A repeat of the value already stored is a no-op: the bbox-debounce
      // cache returns the same object references on every warm hit, so a
      // stationary viewport polling the same tile must not re-stamp every
      // entry and rewrite an unchanged store file once per debounce window.
      // The long retention makes refreshing the timestamp on a view pointless.
      if (entries[id]?.value === value) {
        return
      }
      entries[id] = { timestamp: Date.now(), value }
      // Coalesce a burst of detail loads into one file write: a dense scan can
      // persist many records in quick succession, and rewriting the whole store
      // file on each one would block the event loop repeatedly. The timer is
      // unref'd so a pending write never holds the process open.
      if (writeTimer === undefined) {
        writeTimer = setTimeout(flush, WRITE_DEBOUNCE_MS)
        writeTimer.unref()
      }
    },

    replaceAll: (values: ReadonlyMap<string, V>): void => {
      const timestamp = Date.now()
      entries = {}
      for (const [id, value] of values) {
        entries[id] = { timestamp, value }
      }
      if (writeTimer === undefined) {
        writeTimer = setTimeout(flush, WRITE_DEBOUNCE_MS)
        writeTimer.unref()
      }
    },

    flush,

    clear: (): void => {
      if (writeTimer !== undefined) {
        clearTimeout(writeTimer)
        writeTimer = undefined
      }
      entries = {}
      try {
        rmSync(filePath, { force: true })
        // Also remove any `.tmp` sibling a failed rename may have left behind,
        // so a wipe leaves no debris.
        rmSync(tempPath, { force: true })
      } catch {
        // Nothing persisted, or a file cannot be removed: nothing to do.
      }
    }
  }
}
