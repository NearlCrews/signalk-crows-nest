/**
 * On-disk store for the parsed USCG Local Notice to Mariners layers.
 *
 * Persists one entry per pinned (layer, page) file:
 *
 *   <dataDir>/uscg-lnm/index.json
 *
 * holding, for each file, its conditional-GET headers and its parsed records.
 * The full record set is small (a few thousand notices nationwide), so a
 * single index file is written atomically on change rather than sharded per
 * page the way the much larger USCG Light List store is.
 *
 * The store keeps a per-file record list and derives a UNION view keyed by
 * record id. The union is the mechanism that tolerates the NAVCEN pager's
 * overlapping pages: a category's page `_2` overlaps `_1` heavily (the files
 * are generated seconds apart and are NOT byte-identical: a 2026-07-27 probe
 * found distinct sizes and validators), so both files supply mostly the same
 * record ids and the union collapses each id to one entry. Both snapshots are
 * current, and the union iterates file keys in sorted order so the winner for
 * a shared id is deterministic. A record that upstream drops disappears from
 * the union once the file that carries it is refetched (its content change
 * forces an HTTP 200, replacing that file's list), so the union never
 * permanently retains a deleted record, and `pruneFiles` drops whole files
 * whose key leaves the pinned catalog.
 *
 * Every disk write is atomic: data is written to a `.tmp` sibling and renamed
 * over the target, so a power loss mid-write cannot corrupt the store. A
 * closed store's `flush` is a no-op, so a refresh still in flight when a run is
 * torn down cannot write over a freshly started run at the same data dir.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bboxContainsPoint } from '../../geo/position-utilities.js'
import { atomicWriteJson } from '../../shared/atomic-write-json.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import { USCG_LNM_SOURCE_ID } from '../../shared/source-ids.js'
import type { Bbox } from '../../shared/types.js'
import type { LnmFileEntry, LnmFileHeaders, LnmIndex, LnmRecord } from './lnm-types.js'

/** Name of the single JSON index file inside the store directory. */
const INDEX_FILENAME = 'index.json'

/** Public surface of the on-disk LNM store. */
export interface LnmStore {
  /** Read the persisted index from disk, or start empty on a cold start. */
  load: () => Promise<void>
  /**
   * Replace the record set and headers for one file key. The union view is
   * invalidated and the store marked dirty so the next {@link flush} writes it.
   */
  upsertFile: (key: string, records: readonly LnmRecord[], headers: LnmFileHeaders) => void
  /**
   * Remove every file whose key is not in `validKeys`. Called by the refresh
   * pass with the pinned catalog, so a page NAVCEN retires does not leave its
   * records serving (and, for the danger layers, arming the alarms) forever.
   */
  pruneFiles: (validKeys: ReadonlySet<string>) => void
  /** The conditional-GET headers last stored for a file key, when known. */
  headersFor: (key: string) => LnmFileHeaders | undefined
  /** Write the index to disk atomically, only when something changed. */
  flush: () => Promise<void>
  /** Every record whose position falls within `bbox`, from the union view. */
  queryBbox: (bbox: Bbox) => LnmRecord[]
  /** One record by its source-internal id, or undefined when absent. */
  getById: (id: string) => LnmRecord | undefined
  /** Number of distinct records in the union view. */
  recordCount: () => number
  /** Mark the store closed so a late {@link flush} becomes a no-op. */
  close: () => void
}

/**
 * Narrow an unknown, JSON-parsed value into a usable {@link LnmRecord}. Checks
 * every field the store, the summary path, and the renderer dereference; a
 * corrupt or partially-written entry is dropped rather than crashing a later
 * read. Optional fields are trusted, matching the USCG Light List store's
 * page-file validation.
 */
function isLnmRecord (value: unknown): value is LnmRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<LnmRecord>
  if (record.kind !== 'notice' && record.kind !== 'discrepancy') return false
  if (typeof record.id !== 'string' || typeof record.layer !== 'string') return false
  if (typeof record.name !== 'string' || typeof record.poiType !== 'string') return false
  if (typeof record.skIcon !== 'string' || record.source !== USCG_LNM_SOURCE_ID) return false
  const position = record.position
  if (typeof position !== 'object' || position === null) return false
  return isValidLatitude(position.latitude) && isValidLongitude(position.longitude)
}

/** Narrow a parsed-JSON value into a usable {@link LnmIndex}. */
function isUsableIndex (value: unknown): value is { files: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { files?: unknown }
  return typeof candidate.files === 'object' && candidate.files !== null
}

/** Narrow a parsed-JSON file entry into its headers, dropping unusable records. */
function readFileEntry (value: unknown): LnmFileEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as { headers?: unknown, records?: unknown }
  const headers: LnmFileHeaders = {}
  if (typeof entry.headers === 'object' && entry.headers !== null) {
    const raw = entry.headers as LnmFileHeaders
    if (typeof raw.lastModified === 'string') headers.lastModified = raw.lastModified
    if (typeof raw.etag === 'string') headers.etag = raw.etag
  }
  const records = Array.isArray(entry.records) ? entry.records.filter(isLnmRecord) : []
  return { headers, records }
}

/** Create an LNM store rooted at `<dataDir>/uscg-lnm/`. */
export function createLnmStore (dataDir: string): LnmStore {
  const storeDir = join(dataDir, 'uscg-lnm')
  const indexPath = join(storeDir, INDEX_FILENAME)
  const files = new Map<string, LnmFileEntry>()
  // The union view, keyed by record id, lazily rebuilt from `files` when a
  // read follows a write. `null` marks it stale; a read rebuilds it.
  let union: Map<string, LnmRecord> | null = null
  let generated = new Date().toISOString()
  let dirty = false
  let closed = false

  /** Rebuild the union view from the per-file record lists. */
  function ensureUnion (): Map<string, LnmRecord> {
    if (union !== null) return union
    const built = new Map<string, LnmRecord>()
    // Sorted key order, not Map insertion order: in-session insertion order is
    // the fan-out's completion order, which varies run to run. Overlapping
    // pages are generated seconds apart so either copy of a shared id is
    // current; sorting just makes the winner deterministic.
    for (const key of [...files.keys()].sort()) {
      for (const record of files.get(key)?.records ?? []) {
        built.set(record.id, record)
      }
    }
    union = built
    return built
  }

  return {
    async load () {
      files.clear()
      union = null
      dirty = false
      if (!existsSync(indexPath)) return
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(indexPath, 'utf8'))
      } catch {
        // A missing, unreadable, or unparseable file starts the store empty;
        // the next refresh repopulates it from upstream.
        return
      }
      if (!isUsableIndex(parsed)) return
      if (typeof (parsed as LnmIndex).generated === 'string') {
        generated = (parsed as LnmIndex).generated
      }
      for (const [key, rawEntry] of Object.entries(parsed.files)) {
        const entry = readFileEntry(rawEntry)
        if (entry !== null) files.set(key, entry)
      }
    },

    upsertFile (key, records, headers) {
      files.set(key, { headers, records: [...records] })
      union = null
      generated = new Date().toISOString()
      dirty = true
    },

    pruneFiles (validKeys) {
      for (const key of files.keys()) {
        if (validKeys.has(key)) continue
        files.delete(key)
        union = null
        generated = new Date().toISOString()
        dirty = true
      }
    },

    headersFor (key) {
      return files.get(key)?.headers
    },

    async flush () {
      // A run torn down mid-refresh must not write onto a freshly started run
      // pointing at the same data dir.
      if (closed || !dirty) return
      await mkdir(storeDir, { recursive: true })
      const index: LnmIndex = { generated, files: Object.fromEntries(files) }
      const committed = await atomicWriteJson(indexPath, index, {
        shouldCommit: () => !closed
      })
      if (committed) dirty = false
    },

    queryBbox (bbox) {
      const result: LnmRecord[] = []
      for (const record of ensureUnion().values()) {
        if (bboxContainsPoint(bbox, record.position.longitude, record.position.latitude)) {
          result.push(record)
        }
      }
      return result
    },

    getById (id) {
      return ensureUnion().get(id)
    },

    recordCount () {
      return ensureUnion().size
    },

    close () {
      closed = true
    }
  }
}
