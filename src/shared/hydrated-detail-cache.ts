/**
 * An LRU detail cache backed by an optional on-disk detail store.
 *
 * Glues `detail-store.ts` to the in-memory LRU the at-runtime sources keep:
 * construction hydrates the LRU from disk so a cold start offline still
 * renders previously fetched records, `persist` mirrors a cache insert to the
 * store, and `close` flushes the pending write and drops the in-memory cache
 * while leaving the file in place for the next cold start. The store is
 * dropped on close, so a list promise that resolves after teardown persists
 * nothing; its entries belong to the stopped run.
 *
 * When no data directory is supplied (a memory-only fixture) there is no
 * store: the cache behaves exactly as before, and `persist` is a no-op.
 *
 * This module is node-only (via `detail-store.ts` and `lru-cache`) and never
 * imported by the browser-bundled panel.
 */

import { LRUCache } from 'lru-cache'
import { MAX_POI_CACHE_ENTRIES } from './cache.js'
import { createDetailStore, type DetailStore } from './detail-store.js'

/** Dependencies for {@link createHydratedDetailCache}. */
export interface HydratedDetailCacheOptions<V> {
  /**
   * Plugin data directory for the backing store, or undefined to run in
   * memory only.
   */
  dataDir: string | undefined
  /** Name of the JSON file the store persists to inside the directory. */
  fileName: string
  /** Narrow an unknown, JSON-parsed value to the cached value type. */
  isValue: (value: unknown) => value is V
}

/** An LRU detail cache with disk-backed hydration and persistence. */
export interface HydratedDetailCache<V extends {}> {
  /** The in-memory detail cache, hydrated from disk at construction. */
  cache: LRUCache<string, V>
  /**
   * Mirror one entry to the backing store (a no-op in memory-only mode or
   * after `close`). Call it alongside the `cache.set` for a fetched record.
   */
  persist: (id: string, value: V) => void
  /**
   * Flush the pending store write and drop the in-memory cache. The on-disk
   * file is left in place so a later cold start can hydrate it.
   */
  close: () => void
}

/** Create a detail LRU hydrated from, and mirrored to, an on-disk store. */
export function createHydratedDetailCache<V extends {}> (
  options: HydratedDetailCacheOptions<V>
): HydratedDetailCache<V> {
  const { dataDir, fileName, isValue } = options
  const cache = new LRUCache<string, V>({ max: MAX_POI_CACHE_ENTRIES })
  let store: DetailStore<V> | undefined = dataDir === undefined
    ? undefined
    : createDetailStore<V>({ directoryPath: dataDir, fileName, isValue })
  if (store !== undefined) {
    for (const [id, entry] of Object.entries(store.load())) {
      cache.set(id, entry.value)
    }
  }
  return {
    cache,
    persist: (id: string, value: V): void => {
      store?.persist(id, value)
    },
    close: (): void => {
      store?.flush()
      // Dropping the store reference makes persist a no-op from here on, so a
      // list promise resolving after teardown cannot write a stopped run's
      // entries to disk.
      store = undefined
      cache.clear()
    }
  }
}
