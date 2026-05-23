/**
 * Per-bbox debounce cache for at-runtime POI sources (NOAA ENC, OpenSeaMap).
 *
 * Both sources hit the upstream on every `listPointsOfInterest` call. The
 * position-monitor scan path is already throttled at the monitor (vessel
 * moved at least 100 m and at least 60 s elapsed), but the chart-display
 * path through the notes-resource output is one upstream request per
 * Freeboard refresh on the same viewport. A short-lived LRU keyed on the
 * bbox returns the previous summaries when the same bbox is requested
 * within the configured window, so a refresh burst on a stationary view
 * does not flood the upstream.
 *
 * Off-sentinel matches the rest of the codebase: `ttlSeconds <= 0` disables
 * the cache (the wrapped fetcher is always called). The TTL is measured in
 * seconds because the typical chart-plotter cadence is sub-minute, not
 * sub-hour.
 *
 * The cache is per-source: NOAA ENC and OpenSeaMap each instantiate their
 * own. They share the `MAX_BBOX_CACHE_ENTRIES` ceiling from
 * `src/shared/cache.ts` so a runaway zoom-pan never exhausts memory.
 */

import { LRUCache } from 'lru-cache'
import type { Bbox } from './types.js'

/**
 * A bbox debounce cache. `get` returns the cached summaries when the bbox
 * has been seen within the TTL; otherwise it calls `fetch` and caches the
 * result. The value type is generic so each source caches its own summary
 * shape, but in practice this is always `PoiSummary[]`.
 */
export interface BboxDebounceCache<T> {
  /** Number of entries currently held, exposed for status snapshots. */
  size: () => number
  /**
   * Return the cached value for `bbox` when it is fresh, otherwise call
   * `fetch`, cache its result, and return it.
   */
  get: (bbox: Bbox, fetch: () => Promise<T>) => Promise<T>
  /** Drop every entry. Called by the source on close to release memory. */
  clear: () => void
}

/**
 * Build the cache key for a bbox. Four decimal places (about 11 m) is
 * coarse enough to collapse sub-pixel jitter from Freeboard's bbox math
 * yet fine enough to keep zoom levels distinct.
 */
function bboxKey (bbox: Bbox): string {
  return `${bbox.south.toFixed(4)}_${bbox.west.toFixed(4)}_${bbox.north.toFixed(4)}_${bbox.east.toFixed(4)}`
}

interface Entry<T> {
  fetchedAt: number
  value: T
}

/**
 * Create a debounce cache with the given TTL (in seconds) and entry limit.
 * `ttlSeconds <= 0` disables the cache: `get` always calls `fetch`.
 * `now` is injectable for tests; production callers leave it at the default.
 */
export function createBboxDebounceCache<T> (
  ttlSeconds: number,
  maxEntries: number,
  now: () => number = Date.now
): BboxDebounceCache<T> {
  const ttlMs = Math.max(0, ttlSeconds) * 1000
  const cache = new LRUCache<string, Entry<T>>({ max: maxEntries })
  return {
    size: () => cache.size,
    get: async (bbox, fetch) => {
      if (ttlMs <= 0) {
        return await fetch()
      }
      const key = bboxKey(bbox)
      const hit = cache.get(key)
      if (hit !== undefined && now() - hit.fetchedAt < ttlMs) {
        return hit.value
      }
      const value = await fetch()
      cache.set(key, { fetchedAt: now(), value })
      return value
    },
    clear: () => { cache.clear() }
  }
}
