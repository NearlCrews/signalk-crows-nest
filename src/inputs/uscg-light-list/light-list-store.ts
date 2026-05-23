/**
 * On-disk store for the parsed USCG Light List.
 *
 * Persists a single JSON file at `<dataDir>/uscg-light-list/index.json` that
 * carries per-district headers (for conditional GET on the next refresh) and
 * the merged record map keyed by LLNR. Re-upserting a district replaces ALL
 * its records, so an aid removed upstream does not linger in the index.
 *
 * The set of LLNRs from each district file is tracked in `DistrictMeta.llnrs`
 * (persisted alongside the headers) so a re-upsert can remove the previous
 * record set even after a cold start, and so a record from one (district,
 * page) does not get confused with a record from another page of the same
 * district.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  DistrictHeaders,
  DistrictMeta,
  LightListIndex,
  LightListRecord
} from './light-list-types.js'

/** Name of the persisted JSON file inside `<dataDir>/uscg-light-list/`. */
const INDEX_FILENAME = 'index.json'

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
   * same (district, page) but absent in the new set are removed.
   */
  upsertDistrict: (
    district: string,
    page: number,
    records: readonly LightListRecord[],
    headers: DistrictHeaders
  ) => void
  /** Write the in-memory index out to disk. */
  flush: () => Promise<void>
  /** Return the current in-memory index without reading disk. */
  snapshot: () => LightListIndex
}

/** A fresh, empty index. */
function emptyIndex (): LightListIndex {
  return {
    generated: new Date().toISOString(),
    districts: {},
    records: {}
  }
}

/** Build the persisted-index key for one (district, page) pair. */
function districtKey (district: string, page: number): string {
  return `${district}_${page}`
}

/** Create a Light List store rooted at `<dataDir>/uscg-light-list/`. */
export function createLightListStore (dataDir: string): LightListStore {
  const storeDir = join(dataDir, 'uscg-light-list')
  const filePath = join(storeDir, INDEX_FILENAME)
  let index = emptyIndex()
  return {
    async load () {
      if (!existsSync(filePath)) {
        index = emptyIndex()
        return index
      }
      try {
        const raw = await readFile(filePath, 'utf8')
        index = JSON.parse(raw) as LightListIndex
      } catch {
        // A missing, unreadable, or corrupt file starts the store empty.
        // Letting the read fail at runtime would block the daily refresh on
        // a transient disk error; an empty index forces a full reload on the
        // next refresh, which is the same recovery the cold-start path uses.
        index = emptyIndex()
      }
      return index
    },
    upsertDistrict (district, page, records, headers) {
      const key = districtKey(district, page)
      const previous = index.districts[key]
      if (previous !== undefined) {
        for (const llnr of previous.llnrs) {
          delete index.records[String(llnr)]
        }
      }
      const llnrs: number[] = []
      for (const record of records) {
        index.records[String(record.llnr)] = record
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
    },
    async flush () {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(index), 'utf8')
    },
    snapshot () {
      return index
    }
  }
}
