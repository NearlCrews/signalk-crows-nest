/**
 * On-disk store for the parsed USCG Light List.
 *
 * Persists the index as a small metadata file plus one JSON page per
 * (district, page) pair:
 *
 *   <dataDir>/uscg-light-list/index.json       (per-district headers + llnrs)
 *   <dataDir>/uscg-light-list/pages/D01_1.json (the LightListRecord[] for one page)
 *
 * The previous single-file layout rewrote a ~50 MB blob on every refresh and
 * parsed the same blob on every cold start. Sharding by page lets a refresh
 * write only the pages that changed (typically zero, since most districts
 * answer 304 Not Modified) and lets a cold start parse one page file at a
 * time, capping per-parse blocking work at ~1.5 MB.
 *
 * Every disk write is atomic: data is written to a `.tmp` sibling and renamed
 * over the target, so a power-loss mid-write cannot corrupt the store.
 *
 * The set of LLNRs from each district file is tracked in `DistrictMeta.llnrs`
 * so a re-upsert can remove the previous record set before adding the new
 * one, even after a cold start, and so a record from one (district, page) is
 * not confused with one from another page of the same district.
 *
 * The store also maintains an in-memory spatial tile index keyed by 0.1
 * degree (about 11 km) cells. A bbox query iterates only the tiles that
 * overlap the box rather than scanning the full ~57,700-record map.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  Bbox,
  Position
} from '../../shared/types.js'
import type {
  DistrictHeaders,
  DistrictMeta,
  LightListIndex,
  LightListRecord
} from './light-list-types.js'

/** Name of the small per-district metadata file. */
const INDEX_FILENAME = 'index.json'

/** Subdirectory under the store dir that holds per-page record files. */
const PAGES_DIRNAME = 'pages'

/**
 * Tile cell size, in tenths of a degree, used by the in-memory spatial index.
 * Roughly 11 km at the equator and tighter at higher latitudes; large enough
 * that a typical chartplotter bbox lies inside a handful of tiles, small
 * enough that each tile holds a tractable number of records.
 */
const TILE_CELLS_PER_DEGREE = 10

/**
 * Number of longitude cells (360 degrees * TILE_CELLS_PER_DEGREE). Used as
 * the stride that packs (latCell, lonCell) into a single integer Map key.
 */
const LON_CELL_COUNT = 360 * TILE_CELLS_PER_DEGREE

/** Public surface of the on-disk Light List store. */
export interface LightListStore {
  /**
   * Read the persisted index from disk, or return an empty index on a cold
   * start. The returned index is the same value future calls to
   * {@link snapshot} return until the next {@link upsertDistrict}.
   */
  load: () => Promise<LightListIndex>
  /**
   * Replace the record set for one (district, page), recording the response
   * headers for conditional GET. Records present in a previous upsert of the
   * same (district, page) but absent in the new set are removed. The page
   * is marked dirty so the next {@link flush} writes it.
   */
  upsertDistrict: (
    district: string,
    page: number,
    records: readonly LightListRecord[],
    headers: DistrictHeaders
  ) => void
  /**
   * Write any dirty pages and the metadata file to disk atomically. A page
   * with no changes since the previous flush is not rewritten.
   */
  flush: () => Promise<void>
  /** Return the current in-memory index without reading disk. */
  snapshot: () => LightListIndex
  /**
   * Number of records currently held in the in-memory index, in O(1). Reads
   * the per-record tile bookkeeping rather than allocating the full key list
   * of the records map (~57,700 strings) on every call, and stays accurate
   * after a partial-decode recovery, where summing the per-district
   * `recordCount` metas would over-report.
   */
  recordCount: () => number
  /**
   * Return every record whose position falls within `bbox`, using the
   * in-memory tile index. Per-call cost is O(tiles_in_bbox + records_in_tiles)
   * rather than O(total_records).
   */
  queryBbox: (bbox: Bbox) => LightListRecord[]
  /**
   * Mark the store closed. A closed store's {@link flush} becomes a no-op, so a
   * refresh still in flight when a run is torn down (plugin stop or a
   * config-change restart) cannot write its index over a freshly started run
   * pointing at the same data dir. Write protection lives here, with the
   * component that owns the disk writes, rather than in each caller.
   */
  close: () => void
}

/** A fresh, empty index. */
function emptyIndex (): LightListIndex {
  return {
    generated: new Date().toISOString(),
    districts: {},
    records: {}
  }
}

/**
 * Narrow a parsed-JSON value into a usable metadata file. The new layout
 * carries `districts` but no longer carries `records`; an older single-file
 * `index.json` (with `records`) is also accepted, its districts metadata is
 * read, and the records are reconstituted from the per-page files when those
 * exist or simply re-fetched on the next refresh when they do not.
 */
function isUsableMetadata (value: unknown): value is { districts: Record<string, DistrictMeta> } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { districts?: unknown }
  return typeof candidate.districts === 'object' && candidate.districts !== null
}

/** Build the persisted-index key for one (district, page) pair. */
function districtKey (district: string, page: number): string {
  return `${district}_${page}`
}

/** Compute the integer tile key for a position. */
function tileKey (position: Position): number {
  const latCell = Math.floor((position.latitude + 90) * TILE_CELLS_PER_DEGREE)
  // Clamp the longitude cell into range. Longitude exactly +180 (which
  // isValidLongitude permits) computes LON_CELL_COUNT, one past the last cell,
  // aliasing onto the next latitude row's cell 0. An antimeridian (wrap) query,
  // whose longitude range stops at the last in-range cell, would then never
  // visit it and would silently drop the aid.
  const lonCell = Math.min(
    LON_CELL_COUNT - 1,
    Math.floor((position.longitude + 180) * TILE_CELLS_PER_DEGREE)
  )
  return latCell * LON_CELL_COUNT + lonCell
}

/**
 * The longitude cell ranges (one or two) covered by a bbox. An
 * antimeridian-crossing bbox where `east < west` (e.g. a vessel in the
 * Aleutians whose viewport straddles 180/-180) produces two ranges: one
 * from `west` to lonCell=3599, and one from lonCell=0 to `east`. A normal
 * bbox produces a single contiguous range.
 */
function lonCellRanges (bbox: Bbox): Array<[number, number]> {
  const westCell = Math.floor((bbox.west + 180) * TILE_CELLS_PER_DEGREE)
  const eastCell = Math.floor((bbox.east + 180) * TILE_CELLS_PER_DEGREE)
  if (bbox.east >= bbox.west) {
    return [[westCell, eastCell]]
  }
  return [[westCell, LON_CELL_COUNT - 1], [0, eastCell]]
}

/** Compute the inclusive latitude tile range for a bbox. */
function latCellRange (bbox: Bbox): [number, number] {
  return [
    Math.floor((bbox.south + 90) * TILE_CELLS_PER_DEGREE),
    Math.floor((bbox.north + 90) * TILE_CELLS_PER_DEGREE)
  ]
}

/**
 * True when a record's longitude lies inside the bbox, with antimeridian
 * support. A normal bbox is `west <= longitude <= east`; a wrap bbox is
 * `longitude >= west || longitude <= east`.
 */
function longitudeInBbox (longitude: number, bbox: Bbox): boolean {
  if (bbox.east >= bbox.west) {
    return longitude >= bbox.west && longitude <= bbox.east
  }
  return longitude >= bbox.west || longitude <= bbox.east
}

/**
 * Atomically write JSON to `filePath` by writing a sibling temp file and
 * renaming it over the target. The temp filename carries a per-call random
 * nonce so two concurrent writers to the same target (a stop+start race
 * during an in-flight refresh) do not race on a shared temp path. A failed
 * rename unlinks the temp file so no debris is left behind.
 */
async function atomicWriteJson (filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tempPath, JSON.stringify(value), 'utf8')
  try {
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

/** Create a Light List store rooted at `<dataDir>/uscg-light-list/`. */
export function createLightListStore (dataDir: string): LightListStore {
  const storeDir = join(dataDir, 'uscg-light-list')
  const indexPath = join(storeDir, INDEX_FILENAME)
  const pagesDir = join(storeDir, PAGES_DIRNAME)
  let index = emptyIndex()
  // Tile index: maps a packed (latCell, lonCell) to the records in that
  // tile. Built incrementally on load and on every upsertDistrict so a
  // bbox query never rebuilds from scratch.
  const tiles = new Map<number, LightListRecord[]>()
  // Per-record tile bookkeeping so a record can be removed from its tile in
  // O(1) on re-upsert, without scanning every tile to find it.
  const recordTile = new Map<number, number>()
  // Pages whose in-memory record set has changed since the last flush. The
  // next flush rewrites just these; an untouched district 304-Not-Modified'd
  // by NAVCEN never produces a write.
  const dirtyPages = new Set<string>()
  // Set to true when the in-memory metadata diverges from the on-disk
  // metadata file: a page upsert always counts, since it bumps the
  // `generated` timestamp and the per-district fetchedAt.
  let metadataDirty = false
  // Set by close(). A closed store skips flush so a torn-down run cannot write
  // over a freshly started run sharing the same data dir.
  let closed = false

  function addRecordToIndex (record: LightListRecord): void {
    // Idempotent: if this LLNR already lives in the tile index (from a
    // previous page upsert with the same LLNR, or from a load racing an
    // in-flight refresh), remove its prior entry first so the bucket does
    // not accumulate orphan duplicates that survive future removals.
    if (recordTile.has(record.llnr)) {
      removeRecordFromIndex(record.llnr)
    }
    index.records[String(record.llnr)] = record
    const key = tileKey(record.position)
    let bucket = tiles.get(key)
    if (bucket === undefined) {
      bucket = []
      tiles.set(key, bucket)
    }
    bucket.push(record)
    recordTile.set(record.llnr, key)
  }

  function removeRecordFromIndex (llnr: number): void {
    const idStr = String(llnr)
    delete index.records[idStr]
    const key = recordTile.get(llnr)
    if (key === undefined) return
    recordTile.delete(llnr)
    const bucket = tiles.get(key)
    if (bucket === undefined) return
    const idx = bucket.findIndex((record) => record.llnr === llnr)
    if (idx >= 0) bucket.splice(idx, 1)
    if (bucket.length === 0) tiles.delete(key)
  }

  /** Read the per-page record file for one district key. */
  async function readPageFile (key: string): Promise<LightListRecord[]> {
    try {
      const raw = await readFile(join(pagesDir, `${key}.json`), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      // Check every required LightListRecord field, not just the two the
      // index needs: a corrupt or partially-written page file must not
      // produce records that pass the filter and then fail in the renderer.
      return parsed.filter((value): value is LightListRecord => {
        const record = value as LightListRecord
        return typeof value === 'object' && value !== null &&
          typeof record.llnr === 'number' &&
          typeof record.position === 'object' && record.position !== null &&
          typeof record.name === 'string' &&
          typeof record.district === 'string' &&
          typeof record.volume === 'number' &&
          typeof record.source === 'string' &&
          typeof record.inactive === 'boolean'
      })
    } catch {
      // A missing or unreadable page file leaves its district records absent
      // in memory; the next refresh re-fetches the page from NAVCEN.
      return []
    }
  }

  return {
    async load () {
      index = emptyIndex()
      tiles.clear()
      recordTile.clear()
      dirtyPages.clear()
      metadataDirty = false

      if (!existsSync(indexPath)) {
        return index
      }
      let metadata: { districts: Record<string, DistrictMeta> }
      try {
        const raw = await readFile(indexPath, 'utf8')
        const parsed: unknown = JSON.parse(raw)
        if (!isUsableMetadata(parsed)) {
          // A readable file of the wrong shape (a future format, a
          // hand-edited backup) starts the store empty.
          return index
        }
        metadata = parsed
      } catch {
        // A missing, unreadable, or unparseable file starts the store empty.
        // Letting the read fail at runtime would block the daily refresh on
        // a transient disk error; an empty index forces a full reload on the
        // next refresh.
        return index
      }
      index.districts = metadata.districts
      // Read each page file in parallel, then hydrate the in-memory records
      // and the spatial tile index from the union.
      const keys = Object.keys(metadata.districts)
      const pageRecords = await Promise.all(keys.map(readPageFile))
      keys.forEach((key, i) => {
        const records = pageRecords[i]
        for (const record of records) {
          addRecordToIndex(record)
        }
        // If the page file decoded to a different number of records than
        // the metadata claims (missing file, parse failure, truncated
        // restore, or a partial-decode that lost some entries), drop the
        // cached If-Modified-Since / ETag for the page so the next refresh
        // forces a 200 OK rather than getting a 304 from NAVCEN and leaving
        // records permanently missing. Comparing against `meta.recordCount`
        // (rather than just checking for an empty page) also catches the
        // partial-decode case, where the page file decoded to some records
        // but not all of them. Mark metadataDirty so the cleared headers
        // are persisted on the next flush.
        const meta = index.districts[key]
        if (meta !== undefined && records.length !== meta.recordCount) {
          if (meta.lastModified !== undefined || meta.etag !== undefined) {
            const cleared: DistrictMeta = {
              recordCount: meta.recordCount,
              fetchedAt: meta.fetchedAt,
              llnrs: meta.llnrs
            }
            index.districts[key] = cleared
            metadataDirty = true
          }
        }
      })
      return index
    },

    upsertDistrict (district, page, records, headers) {
      const key = districtKey(district, page)
      const previous = index.districts[key]
      if (previous !== undefined) {
        // Tolerate a district meta missing `llnrs` (a corrupt or truncated
        // index): an unguarded for...of threw per page and wedged the source.
        // The upsert below rewrites a clean meta, so the store self-heals.
        for (const llnr of previous.llnrs ?? []) {
          removeRecordFromIndex(llnr)
        }
      }
      const llnrs: number[] = []
      for (const record of records) {
        addRecordToIndex(record)
        llnrs.push(record.llnr)
      }
      const meta: DistrictMeta = {
        recordCount: records.length,
        fetchedAt: new Date().toISOString(),
        llnrs
      }
      if (headers.lastModified !== undefined) {
        meta.lastModified = headers.lastModified
      }
      if (headers.etag !== undefined) {
        meta.etag = headers.etag
      }
      index.districts[key] = meta
      index.generated = new Date().toISOString()
      dirtyPages.add(key)
      metadataDirty = true
    },

    async flush () {
      // A run torn down mid-refresh must not write onto a freshly started run
      // pointing at the same data dir; the next run re-refreshes from its own
      // loaded index.
      if (closed) return
      if (!metadataDirty && dirtyPages.size === 0) return
      await mkdir(pagesDir, { recursive: true })
      // Write every dirty page in parallel: each is its own atomic
      // temp-rename, so a failure on one does not corrupt the others. The
      // record set per page is reconstituted by following the persisted
      // llnrs list back into the in-memory records map, which is O(L)
      // per page rather than O(N) (the alternative full-scan filter).
      const pageWrites = [...dirtyPages].map(async (key) => {
        const llnrs = index.districts[key]?.llnrs ?? []
        const records: LightListRecord[] = []
        for (const llnr of llnrs) {
          const record = index.records[String(llnr)]
          if (record !== undefined) records.push(record)
        }
        await atomicWriteJson(join(pagesDir, `${key}.json`), records)
      })
      await Promise.all(pageWrites)
      // Metadata persists only the districts table, never the records map:
      // records live in their page files.
      await atomicWriteJson(indexPath, {
        generated: index.generated,
        districts: index.districts
      })
      dirtyPages.clear()
      metadataDirty = false
    },

    snapshot () {
      return index
    },

    recordCount () {
      // recordTile holds exactly one entry per record in the index (kept in
      // sync by addRecordToIndex/removeRecordFromIndex), so its size is the
      // live record total without scanning or allocating.
      return recordTile.size
    },

    close () {
      closed = true
    },

    queryBbox (bbox) {
      const result: LightListRecord[] = []
      const [latStart, latEnd] = latCellRange(bbox)
      const lonRanges = lonCellRanges(bbox)
      for (let lat = latStart; lat <= latEnd; lat += 1) {
        const latBase = lat * LON_CELL_COUNT
        for (const [lonStart, lonEnd] of lonRanges) {
          for (let lon = lonStart; lon <= lonEnd; lon += 1) {
            const bucket = tiles.get(latBase + lon)
            if (bucket === undefined) continue
            for (const record of bucket) {
              const { latitude, longitude } = record.position
              if (latitude >= bbox.south && latitude <= bbox.north &&
                longitudeInBbox(longitude, bbox)) {
                result.push(record)
              }
            }
          }
        }
      }
      return result
    }
  }
}
