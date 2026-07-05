/**
 * Time-bounded cache for point-of-interest detail responses, with
 * stale-on-error: POI details are nearly static (a marina does not move), so
 * when an entry's freshness window has lapsed and the refetch FAILS (the
 * vessel is offline, the API is down), the expired entry is served rather
 * than rejecting; the freshness TTL governs how eagerly a reachable upstream
 * is re-queried, not whether known data is usable.
 *
 * On a true miss (no entry, fresh or stale) the configured fetchMethod loads
 * the entry from the ActiveCaptain client; a rejected load propagates to the
 * caller and is not stored.
 *
 * When a persistent {@link PoiStore} is supplied, the cache hydrates from it
 * on creation so a cold start has offline data without a network round-trip:
 * entries still inside the freshness window keep their remaining freshness,
 * and older retained entries hydrate as stale-but-usable, so the offline
 * fallback survives a restart. Every real load is persisted back. The
 * persistent layer is always on; it has no configuration toggle.
 */

import { LRUCache } from 'lru-cache'
import type { PoiStore } from './poi-store.js'
import { MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import { MS_PER_MINUTE } from '../../shared/time.js'
import type { PoiDetails } from './active-captain-types.js'

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

/**
 * Per-call fetch context: carries a failed load's error out of the cache,
 * whose stale-on-error options otherwise swallow the rejection into an
 * `undefined` result.
 */
interface FetchContext {
  error?: unknown
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
  const cache = new LRUCache<string, PoiDetails, FetchContext>({
    max: MAX_POI_CACHE_ENTRIES,
    ttl: ttlMs,
    // Stale-on-error: when a stale entry's refetch rejects (offline, API
    // down), serve the stale details instead of rejecting, and keep the
    // entry so the next read can try again. POI details are nearly static,
    // so a lapsed entry beats no answer at the helm. With no stale value to
    // fall back on, the rejection surfaces through the fetch context below.
    allowStaleOnFetchRejection: true,
    noDeleteOnFetchRejection: true,
    fetchMethod: async (id, _stale, { context }): Promise<PoiDetails> => {
      try {
        const details = await client.pointOfInterestDetails(id)
        listener.onLoadSuccess?.()
        // Persist the freshly loaded entry so a later cold start can serve it
        // offline. A failed write is swallowed inside the store.
        store?.persist(id, details)
        return details
      } catch (error) {
        // The stale-on-error options make the cache swallow this rejection,
        // so the real error rides the per-call context for `get` to rethrow
        // when there is no stale value to serve instead.
        context.error = error
        listener.onLoadError?.(error)
        throw error
      }
    }
  })

  // Hydrate the in-memory cache from the persistent store, aging each entry
  // from its persist time via the library's own `start` option: an entry
  // inside the freshness window keeps its true remaining freshness, and an
  // older retained entry lands already stale, never served while a fetch can
  // succeed but available as the stale-on-error fallback when the vessel is
  // offline, which is the point of the on-disk store. The `Math.min` clamp
  // keeps a future timestamp (backward clock skew, or a store file copied
  // off another machine) from extending an entry beyond the TTL window.
  if (store !== undefined) {
    const now = Date.now()
    for (const [id, entry] of Object.entries(store.load())) {
      cache.set(id, entry.value, { start: Math.min(now, entry.timestamp) })
    }
  }

  return {
    get: async (id: string): Promise<PoiDetails> => {
      const context: FetchContext = {}
      const details = await cache.fetch(id, { context })
      if (details === undefined) {
        // A miss whose load failed with nothing stale to serve: rethrow the
        // load's own error (captured by fetchMethod) so the caller sees the
        // real failure. The fallback covers a concurrent caller coalesced
        // onto another call's in-flight load, whose context stays empty.
        throw context.error ?? new Error(`No point of interest details available for ${id}`)
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
