/**
 * Disk-backed key-value store of point-of-interest detail.
 *
 * The store persists detail responses to a single JSON file in the plugin's
 * data directory so the in-memory cache (see `poi-cache.ts`) can be hydrated on
 * a cold start, giving the plugin offline data without a network round-trip.
 *
 * Every read and write is resilient: a missing, unreadable, or corrupt store
 * file never throws to the caller, the store simply behaves as if it were
 * empty. A failed write is swallowed, the entry survives in memory and is
 * re-fetched on a future cold start.
 *
 * Writes are debounced. A `persist` updates the in-memory mirror and schedules
 * one file write a short while later, so a burst of detail loads collapses into
 * a single rewrite rather than rewriting the whole file once per POI. `flush`
 * forces a pending write out at once; the plugin calls it on stop so a clean
 * shutdown loses nothing.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MS_PER_MINUTE } from '../../shared/time.js'
import type { PoiDetails } from './active-captain-types.js'

/** Name of the JSON file the store persists to inside the data directory. */
const STORE_FILE_NAME = 'poi-cache.json'

/**
 * How long, in milliseconds, a `persist` waits before the file write runs. A
 * burst of loads inside this window collapses into one rewrite of the store.
 */
const WRITE_DEBOUNCE_MS = 1000

/** On-disk format version, bumped if the file layout ever changes. */
const STORE_VERSION = 1

/** A point-of-interest detail entry as held in the store, with its age. */
export interface StoredPoi {
  /** Epoch milliseconds at which the entry was persisted. */
  timestamp: number
  /** The cached detail response. */
  details: PoiDetails
}

/** The on-disk shape of the store file. */
interface StoreFile {
  version: number
  entries: Record<string, StoredPoi>
}

/** Public surface of the persistent point-of-interest detail store. */
export interface PoiStore {
  /**
   * Read the non-expired entries from disk, keyed by point-of-interest id.
   * Entries older than the configured TTL window are dropped. A missing or
   * corrupt store file yields an empty map rather than an error.
   */
  load: () => Map<string, StoredPoi>
  /**
   * Record (or replace) one entry, stamped with the current time, and schedule
   * a debounced write of the whole store to disk.
   */
  persist: (id: string, details: PoiDetails) => void
  /** Write any pending debounced change to disk now. */
  flush: () => void
  /** Drop every persisted entry and remove the backing file. */
  clear: () => void
}

/**
 * Narrow an unknown value to {@link PoiDetails}. This checks the fields the
 * plugin dereferences without a further guard (`pointOfInterest.poiType`,
 * `.name`, `.mapLocation`), so a hydrated entry cannot crash `getResource`.
 */
function isPoiDetails (value: unknown): value is PoiDetails {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const poi = (value as { pointOfInterest?: unknown }).pointOfInterest
  if (typeof poi !== 'object' || poi === null) {
    return false
  }
  const fields = poi as Record<string, unknown>
  return (
    typeof fields.poiType === 'string' &&
    typeof fields.name === 'string' &&
    typeof fields.mapLocation === 'object' &&
    fields.mapLocation !== null
  )
}

/** Narrow an unknown value to a {@link StoredPoi}. */
function isStoredPoi (value: unknown): value is StoredPoi {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Partial<StoredPoi>
  return typeof entry.timestamp === 'number' && isPoiDetails(entry.details)
}

/** Narrow an unknown parsed value to a {@link StoreFile}. */
function isStoreFile (value: unknown): value is StoreFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const file = value as Partial<StoreFile>
  return (
    file.version === STORE_VERSION &&
    typeof file.entries === 'object' &&
    file.entries !== null
  )
}

/**
 * Create a persistent point-of-interest detail store.
 *
 * @param directoryPath Directory the store file lives in, typically the value
 *                      of the SignalK app's `getDataDirPath()`.
 * @param ttlMinutes    How long, in minutes, a persisted entry stays fresh.
 *                      Entries older than this are dropped on `load`.
 */
export function createPoiStore (directoryPath: string, ttlMinutes: number): PoiStore {
  const filePath = join(directoryPath, STORE_FILE_NAME)
  const ttlMs = ttlMinutes * MS_PER_MINUTE

  // In-memory mirror of the on-disk store, kept current so each persist can
  // rewrite the whole file without re-reading it. Populated by load().
  let entries: Record<string, StoredPoi> = {}

  // A pending debounced write, or undefined when no write is scheduled.
  let writeTimer: NodeJS.Timeout | undefined

  // Write the in-memory mirror to disk. Writes go to a temp file that is then
  // renamed over the target, so a crash mid-write cannot corrupt the store.
  // The temp path is fixed (no pid), so at most one stale temp file can ever
  // exist; the next write truncates and reuses it. A failed rename unlinks the
  // temp file so a write error does not leave debris behind.
  const tempPath = `${filePath}.tmp`
  const writeFile = (): void => {
    const payload: StoreFile = { version: STORE_VERSION, entries }
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
    load: (): Map<string, StoredPoi> => {
      const result = new Map<string, StoredPoi>()
      entries = {}

      let raw: string
      try {
        raw = readFileSync(filePath, 'utf8')
      } catch {
        // No store file yet (first run), or it cannot be read: start empty.
        return result
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        // Corrupt JSON: discard the file's contents and start empty.
        return result
      }

      if (!isStoreFile(parsed)) {
        // A readable file of the wrong shape (e.g. an older format): ignore it.
        return result
      }

      const cutoff = Date.now() - ttlMs
      for (const [id, entry] of Object.entries(parsed.entries)) {
        if (!isStoredPoi(entry) || entry.timestamp < cutoff) {
          // Malformed or stale entry: drop it from both the map and the mirror.
          continue
        }
        entries[id] = entry
        result.set(id, entry)
      }
      return result
    },

    persist: (id: string, details: PoiDetails): void => {
      entries[id] = { timestamp: Date.now(), details }
      // Coalesce a burst of detail loads into one file write: a dense scan can
      // persist many POIs in quick succession, and rewriting the whole store
      // file on each one would block the event loop repeatedly. The timer is
      // unref'd so a pending write never holds the process open.
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
