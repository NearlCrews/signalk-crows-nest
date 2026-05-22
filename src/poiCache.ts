/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Time-bounded cache for point-of-interest detail responses.
 *
 * This module replaces the old @inventivetalent/loading-cache and
 * @inventivetalent/time dependencies with lru-cache (v11). On a cache miss the
 * configured fetchMethod loads the entry from the ActiveCaptain client; a
 * rejected load propagates to the caller and is not stored.
 */

import { LRUCache } from 'lru-cache'
import type { PoiDetails } from './types.js'

/** Hard ceiling on cached entries, guarding memory use on long sessions. */
const MAX_CACHE_ENTRIES = 5000

/** Number of milliseconds in one minute. */
const MS_PER_MINUTE = 60_000

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
  /** Drop every cached entry. Call this from plugin.stop. */
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
 */
export function createPoiCache (
  client: PoiDetailsSource,
  ttlMinutes: number,
  listener: PoiCacheListener = {}
): PoiCache {
  const cache = new LRUCache<string, PoiDetails>({
    max: MAX_CACHE_ENTRIES,
    ttl: ttlMinutes * MS_PER_MINUTE,
    fetchMethod: async (id: string): Promise<PoiDetails> => {
      try {
        const details = await client.pointOfInterestDetails(id)
        listener.onLoadSuccess?.()
        return details
      } catch (error) {
        listener.onLoadError?.(error)
        throw error
      }
    }
  })

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
    },
    size: (): number => {
      return cache.size
    }
  }
}
