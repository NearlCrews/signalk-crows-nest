/**
 * Disk-backed store of ActiveCaptain point-of-interest detail.
 *
 * A thin binding of the shared `detail-store.ts` mechanism (debounced atomic
 * writes, long retention, capped entries, resilient reads) to the ActiveCaptain
 * value type and file name. The in-memory cache (see `poi-cache.ts`) hydrates
 * from it on a cold start, giving the plugin offline data without a network
 * round-trip; entries past the in-memory freshness TTL but within retention
 * hydrate as stale-but-usable.
 *
 * The store file is versioned at 2: version 1 files persisted the detail under
 * a `details` field where the shared store uses `value`, so a leftover version
 * 1 file is discarded on load and the cache regenerates from the live API.
 */

import {
  createDetailStore,
  DEFAULT_DETAIL_STORE_RETENTION_MINUTES,
  type DetailStore
} from '../../shared/detail-store.js'
import type { PoiDetails } from './active-captain-types.js'

/** Name of the JSON file the store persists to inside the data directory. */
const STORE_FILE_NAME = 'poi-cache.json'

/** On-disk format version; see the module comment for the history. */
const STORE_VERSION = 2

/**
 * Default on-disk retention, in minutes: 30 days. Entries older than this are
 * dropped on `load`. The window bounds file growth, not data freshness; the
 * in-memory cache's own TTL decides when an entry is refetched while online.
 */
const DEFAULT_STORE_RETENTION_MINUTES = DEFAULT_DETAIL_STORE_RETENTION_MINUTES

/** Public surface of the persistent point-of-interest detail store. */
export type PoiStore = DetailStore<PoiDetails>

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

/**
 * Create a persistent point-of-interest detail store.
 *
 * @param directoryPath    Directory the store file lives in, typically the
 *                         value of the SignalK app's `getDataDirPath()`.
 * @param retentionMinutes How long, in minutes, a persisted entry is retained.
 *                         Entries older than this are dropped on `load`.
 *                         Defaults to {@link DEFAULT_STORE_RETENTION_MINUTES};
 *                         injectable for tests.
 */
export function createPoiStore (
  directoryPath: string,
  retentionMinutes: number = DEFAULT_STORE_RETENTION_MINUTES
): PoiStore {
  return createDetailStore<PoiDetails>({
    directoryPath,
    fileName: STORE_FILE_NAME,
    isValue: isPoiDetails,
    retentionMinutes,
    version: STORE_VERSION
  })
}
