/**
 * Time-bounded cache for point-of-interest detail responses.
 *
 * On a cache miss the configured fetchMethod loads the entry from the
 * ActiveCaptain client; a rejected load propagates to the caller and is not
 * stored.
 *
 * When a persistent {@link PoiStore} is supplied, the cache hydrates from it
 * on creation so a cold start has offline data without a network round-trip,
 * and persists every real load back to it. The persistent layer is always on;
 * it has no configuration toggle.
 */

import { LRUCache } from 'lru-cache'
import type { PoiStore } from './poi-store.js'
import { MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import { MS_PER_MINUTE } from '../../shared/time.js'
import type { PoiDetails } from '../../shared/types.js'

/** The slice of the ActiveCaptain client this cache depends on. */
export interface PoiDetailsSource {
  pointOfInterestDetails: (id: string) => Promise<PoiDetails>
}

/**
 * Notifications about loads that actually reached the source. They fire only
 * on a cache miss, never on a hit, so a caller can record API-reachability
 * without a cache hit masquerading as a fresh successful request.
 */
export interface PoiCacheListener {
  /** A load from the source succeeded. */
  onLoadSuccess?: () => void
  /** A load from the source failed. */
  onLoadError?: (error: unknown) => void
}

/** Public surface of the point-of-interest detail cache. */
export interface PoiCache {
  /**
   * Resolve the detail summary for an id, loading it on a miss. Rejects when
   * the underlying load rejects.
   */
  get: (id: string) => Promise<PoiDetails>
  /**
   * Drop every cached entry, in memory and on disk. This is a full wipe: it
   * also empties the persistent store, so do NOT call it from plugin.stop,
   * which would discard the offline cache on every config-change restart.
   */
  clear: () => void
  /** Number of detail entries currently held in the cache. */
  size: () => number
}

/**
 * Create a point-of-interest detail cache.
 *
 * @param client     Source used to load entries on a cache miss.
 * @param ttlMinutes How long, in minutes, a loaded entry stays fresh.
 * @param listener   Optional hooks invoked only on a real load (a cache miss).
 * @param store      Optional persistent store. When supplied, the cache
 *                   hydrates from it on creation and persists every real load
 *                   back to it, surviving plugin restarts.
 */
export function createPoiCache (
  client: PoiDetailsSource,
  ttlMinutes: number,
  listener: PoiCacheListener = {},
  store?: PoiStore
): PoiCache {
  const ttlMs = ttlMinutes * MS_PER_MINUTE
  const cache = new LRUCache<string, PoiDetails>({
    max: MAX_POI_CACHE_ENTRIES,
    ttl: ttlMs,
    fetchMethod: async (id: string): Promise<PoiDetails> => {
      try {
        const details = await client.pointOfInterestDetails(id)
        listener.onLoadSuccess?.()
        // Persist the freshly loaded entry so a later cold start can serve it
        // offline. A failed write is swallowed inside the store.
        store?.persist(id, details)
        return details
      } catch (error) {
        listener.onLoadError?.(error)
        throw error
      }
    }
  })

  // Hydrate the in-memory cache from the persistent store. Each entry keeps
  // only its true remaining freshness, so a restart never extends an entry's
  // lifetime beyond the configured TTL window.
  if (store !== undefined) {
    const now = Date.now()
    for (const [id, entry] of store.load()) {
      // Clamp to at most ttlMs: a timestamp in the future (backward clock
      // skew, or a store file copied from another machine) would otherwise
      // make the entry outlive the configured TTL window.
      const remainingTtl = Math.min(ttlMs, ttlMs - (now - entry.timestamp))
      if (remainingTtl > 0) {
        cache.set(id, entry.details, { ttl: remainingTtl })
      }
    }
  }

  return {
    get: async (id: string): Promise<PoiDetails> => {
      const details = await cache.fetch(id)
      if (details === undefined) {
        throw new Error(`No point of interest details available for ${id}`)
      }
      return details
    },
    clear: (): void => {
      cache.clear()
      // Also drop the persisted copy so a restart starts genuinely empty.
      store?.clear()
    },
    size: (): number => {
      return cache.size
    }
  }
}
