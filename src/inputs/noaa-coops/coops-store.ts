/**
 * On-disk store for the parsed NOAA CO-OPS station lists.
 *
 * Both station families are small (a few hundred entries each) and change
 * rarely, so the whole index is a single JSON file rather than the sharded
 * per-page layout the much larger USCG Light List needs:
 *
 *   <dataDir>/noaa-coops/index.json
 *
 * The file holds per-type metadata (record count, fetch time, and the response
 * headers for a best-effort conditional GET) plus the merged record map keyed
 * by internal id. A refresh replaces the record set for one type in place. Every
 * write is atomic: data is written to a `.tmp` sibling and renamed over the
 * target, so a power loss mid-write cannot corrupt the store. A file that fails
 * to parse, or is of the wrong shape, starts the store empty and forces a full
 * reload on the next refresh.
 *
 * With only a few hundred stations, `queryBbox` is a linear scan; no spatial
 * index is warranted.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bboxContainsPoint } from '../../geo/position-utilities.js'
import { atomicWriteJson } from '../../shared/atomic-write-json.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import type { Bbox } from '../../shared/types.js'
import { coopsInternalId } from './coops-mapping.js'
import type {
  CoopsIndex,
  CoopsStationHeaders,
  CoopsStationRecord,
  CoopsStationType,
  CoopsTypeMeta
} from './noaa-coops-types.js'

/** Name of the single index file under the store dir. */
const INDEX_FILENAME = 'index.json'

/** Public surface of the on-disk CO-OPS store. */
export interface CoopsStore {
  /**
   * Read the persisted index from disk, or return an empty index on a cold
   * start. The returned index is the same value future calls to {@link snapshot}
   * return until the next {@link upsertType}.
   */
  load: () => Promise<CoopsIndex>
  /**
   * Replace the record set for one station type, recording the response headers
   * for a later conditional GET. Records of the same type from a previous upsert
   * are removed first. Marks the index dirty so the next {@link flush} writes it.
   */
  upsertType: (
    stationType: CoopsStationType,
    records: readonly CoopsStationRecord[],
    headers: CoopsStationHeaders
  ) => void
  /** Write the index to disk atomically when it has changed since the last flush. */
  flush: () => Promise<void>
  /** Return the current in-memory index without reading disk. */
  snapshot: () => CoopsIndex
  /** Number of station records currently held in the in-memory index. */
  recordCount: () => number
  /** Return every station whose position falls within `bbox`. */
  queryBbox: (bbox: Bbox) => CoopsStationRecord[]
  /**
   * Mark the store closed. A closed store's {@link flush} becomes a no-op, so a
   * refresh still in flight when a run is torn down cannot write its index over
   * a freshly started run pointing at the same data dir.
   */
  close: () => void
}

/** A fresh, empty index. */
function emptyIndex (): CoopsIndex {
  return {
    generated: new Date().toISOString(),
    types: {},
    records: {}
  }
}

/** True when a value is a usable station type. */
function isCoopsStationType (value: unknown): value is CoopsStationType {
  return value === 'tide' || value === 'current'
}

/**
 * Narrow a parsed-JSON value into a usable index. Only the two containers the
 * store dereferences are checked here; each record is validated individually on
 * load so a single corrupt entry is dropped rather than discarding the file.
 */
function isUsableIndex (value: unknown): value is { types: Record<string, CoopsTypeMeta>, records: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { types?: unknown, records?: unknown }
  return typeof candidate.types === 'object' && candidate.types !== null &&
    typeof candidate.records === 'object' && candidate.records !== null
}

/**
 * True when a parsed value carries every CoopsStationRecord field the renderer
 * and the bbox scan dereference. A corrupt or partially-written record is
 * dropped rather than crashing the renderer or poisoning the distance math.
 */
function isUsableRecord (value: unknown): value is CoopsStationRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as CoopsStationRecord
  return typeof record.id === 'string' &&
    isCoopsStationType(record.stationType) &&
    typeof record.name === 'string' &&
    typeof record.position === 'object' && record.position !== null &&
    isValidLatitude(record.position.latitude) &&
    isValidLongitude(record.position.longitude)
}

/**
 * True when an incoming record set matches the held set for a type by id and
 * content. The mdapi answers 200 on every poll even when nothing changed (see
 * coops-client.ts), so this lets an unchanged refresh skip re-stamping and
 * rewriting the index. Both sides come from the same parser, so a per-record
 * JSON comparison is a sound content check, and the id map makes it
 * order-independent.
 */
function sameRecordSet (
  held: readonly CoopsStationRecord[],
  incoming: readonly CoopsStationRecord[]
): boolean {
  if (held.length !== incoming.length) return false
  const heldById = new Map(held.map((record) => [coopsInternalId(record), record]))
  for (const record of incoming) {
    const existing = heldById.get(coopsInternalId(record))
    if (existing === undefined) return false
    if (JSON.stringify(existing) !== JSON.stringify(record)) return false
  }
  return true
}

/** Create a CO-OPS store rooted at `<dataDir>/noaa-coops/`. */
export function createCoopsStore (dataDir: string): CoopsStore {
  const storeDir = join(dataDir, 'noaa-coops')
  const indexPath = join(storeDir, INDEX_FILENAME)
  let index = emptyIndex()
  // Set when the in-memory index diverges from the on-disk file: an upsert, or
  // a load-time header recovery, both set it.
  let dirty = false
  // Set by close(). A closed store skips flush so a torn-down run cannot write
  // over a freshly started run sharing the same data dir.
  let closed = false

  /** Records currently held for one station type. */
  function recordsOfType (stationType: CoopsStationType): CoopsStationRecord[] {
    return Object.values(index.records).filter((record) => record.stationType === stationType)
  }

  return {
    async load () {
      index = emptyIndex()
      dirty = false

      if (!existsSync(indexPath)) {
        return index
      }
      let parsed: { types: Record<string, CoopsTypeMeta>, records: Record<string, unknown> }
      try {
        const raw = await readFile(indexPath, 'utf8')
        const value: unknown = JSON.parse(raw)
        if (!isUsableIndex(value)) {
          // A readable file of the wrong shape (a future format, a hand-edited
          // backup) starts the store empty.
          return index
        }
        parsed = value
      } catch {
        // A missing, unreadable, or unparseable file starts the store empty; the
        // next refresh reloads from upstream.
        return index
      }
      // Adopt only the recognized per-type metadata.
      for (const [type, meta] of Object.entries(parsed.types)) {
        if (isCoopsStationType(type)) {
          index.types[type] = meta
        }
      }
      // Adopt only the records that pass validation.
      for (const [id, record] of Object.entries(parsed.records)) {
        if (isUsableRecord(record)) {
          index.records[id] = record
        }
      }
      // Header recovery: if a type decoded to fewer records than its metadata
      // claims (a dropped corrupt entry), clear that type's cached conditional-GET
      // headers so the next refresh forces a 200 rather than a 304 that would
      // leave the record permanently missing.
      for (const type of Object.keys(index.types) as CoopsStationType[]) {
        const meta = index.types[type]
        if (meta === undefined) continue
        const actual = recordsOfType(type).length
        if (actual !== meta.recordCount && (meta.lastModified !== undefined || meta.etag !== undefined)) {
          index.types[type] = { recordCount: meta.recordCount, fetchedAt: meta.fetchedAt }
          dirty = true
        }
      }
      return index
    },

    upsertType (stationType, records, headers) {
      const held = recordsOfType(stationType)
      // The mdapi answers 200 on every poll even when the station list is
      // unchanged (it does not honor conditional GET), so an unchanged refresh
      // would otherwise re-stamp every record, bump `generated`, mark the index
      // dirty, and rewrite the whole index.json to the SD card each time. When
      // the incoming set matches the held set by id and content, skip the work
      // and leave the index clean so flush writes nothing. The stored etag and
      // lastModified are left as-is: they still describe the unchanged content,
      // and a server that ignores conditional GET makes refreshing them moot.
      if (sameRecordSet(held, records)) {
        return
      }
      for (const record of held) {
        delete index.records[coopsInternalId(record)]
      }
      for (const record of records) {
        index.records[coopsInternalId(record)] = record
      }
      const meta: CoopsTypeMeta = {
        recordCount: records.length,
        fetchedAt: new Date().toISOString()
      }
      if (headers.lastModified !== undefined) {
        meta.lastModified = headers.lastModified
      }
      if (headers.etag !== undefined) {
        meta.etag = headers.etag
      }
      index.types[stationType] = meta
      index.generated = new Date().toISOString()
      dirty = true
    },

    async flush () {
      // A run torn down mid-refresh must not write onto a freshly started run
      // pointing at the same data dir; the next run reloads from its own index.
      if (closed) return
      if (!dirty) return
      await mkdir(storeDir, { recursive: true })
      await atomicWriteJson(indexPath, {
        generated: index.generated,
        types: index.types,
        records: index.records
      })
      dirty = false
    },

    snapshot () {
      return index
    },

    recordCount () {
      return Object.keys(index.records).length
    },

    queryBbox (bbox) {
      const result: CoopsStationRecord[] = []
      for (const record of Object.values(index.records)) {
        const { latitude, longitude } = record.position
        if (bboxContainsPoint(bbox, longitude, latitude)) {
          result.push(record)
        }
      }
      return result
    },

    close () {
      closed = true
    }
  }
}
