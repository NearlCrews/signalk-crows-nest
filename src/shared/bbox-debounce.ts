/**
 * Per-bbox debounce cache for POI sources.
 *
 * Every source hits its upstream on every `listPointsOfInterest` call. The
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
 * seconds because the typical chart-plotter cadence is sub-minute.
 *
 * The cache is per-source: ActiveCaptain, NOAA ENC, and OpenSeaMap each
 * instantiate their own. They share the `MAX_BBOX_CACHE_ENTRIES` ceiling
 * from `src/shared/cache.ts` so a runaway zoom-pan never exhausts memory.
 *
 * This module also owns the canonical refresh-period bounds, default, and
 * clamp helper (`MIN_BBOX_DEBOUNCE_SECONDS`,
 * `MAX_BBOX_DEBOUNCE_SECONDS`, `DEFAULT_BBOX_DEBOUNCE_SECONDS`,
 * `clampBboxDebounceSeconds`). Each input module's config-schema fragment
 * and the panel's normalize-config use them, so a change to the bounds is
 * one edit, not four.
 */

import { LRUCache } from 'lru-cache'
import type { Bbox } from './types.js'

/** Default per-bbox debounce window, in seconds. */
export const DEFAULT_BBOX_DEBOUNCE_SECONDS = 30

/**
 * Smallest configurable value. `0` is the off sentinel (no caching), so the
 * minimum below the off sentinel does not exist; the minimum is itself `0`.
 */
export const MIN_BBOX_DEBOUNCE_SECONDS = 0

/**
 * Largest configurable value. A 10 min cap is plenty for the chart-plotter
 * cadence (sub-minute typical) and protects against a hand-edited config
 * value that would otherwise effectively disable upstream querying.
 */
export const MAX_BBOX_DEBOUNCE_SECONDS = 600

/**
 * Clamp a raw refresh-seconds value into the supported range, falling back
 * to {@link DEFAULT_BBOX_DEBOUNCE_SECONDS} on any non-numeric or
 * non-finite input.
 */
export function clampBboxDebounceSeconds (raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_BBOX_DEBOUNCE_SECONDS
  }
  if (raw < MIN_BBOX_DEBOUNCE_SECONDS) return MIN_BBOX_DEBOUNCE_SECONDS
  if (raw > MAX_BBOX_DEBOUNCE_SECONDS) return MAX_BBOX_DEBOUNCE_SECONDS
  return Math.trunc(raw)
}

/**
 * Config-schema fragment for a source's bbox-debounce window field, in seconds.
 * The at-runtime sources (ActiveCaptain, OpenSeaMap, NOAA ENC) each declare an
 * identical number field over the debounce bounds differing only in its title,
 * so the shape lives here next to the bounds it carries.
 */
export function refreshSecondsSchema (title: string): Record<string, unknown> {
  return {
    type: 'number',
    title,
    default: DEFAULT_BBOX_DEBOUNCE_SECONDS,
    minimum: MIN_BBOX_DEBOUNCE_SECONDS,
    maximum: MAX_BBOX_DEBOUNCE_SECONDS
  }
}

/**
 * A bbox debounce cache. `get` returns the cached value when the bbox
 * has been seen within the TTL; otherwise it calls `fetch` and caches the
 * result. The value type is generic so each source caches its own shape.
 */
export interface BboxDebounceCache<T> {
  /**
   * Return the cached value for `bbox` (and the optional `extraKey`) when
   * it is fresh, otherwise call `fetch`, cache its result, and return it.
   * `extraKey` is appended to the cache key so a source whose upstream
   * filters server-side on a request argument (ActiveCaptain's `poiTypes`,
   * for example) does not let one caller's narrower request poison a later
   * caller's wider one.
   */
  get: (bbox: Bbox, fetch: () => Promise<T>, extraKey?: string) => Promise<T>
  /** Drop every entry. Called by the source on close to release memory. */
  clear: () => void
}

/**
 * Build the cache key for a bbox and an optional extra discriminator. Four
 * decimal places (about 11 m) is coarse enough to collapse sub-pixel jitter
 * from Freeboard's bbox math yet fine enough to keep zoom levels distinct.
 *
 * `extraKey` is escaped before joining so a future caller whose discriminator
 * happens to contain a literal `|` cannot collide with another caller's
 * bbox-plus-remainder. Backslashes inside the discriminator are escaped first
 * to keep the escaping unambiguous.
 */
function bboxKey (bbox: Bbox, extraKey?: string): string {
  const base =
    `${bbox.south.toFixed(4)}_${bbox.west.toFixed(4)}_${bbox.north.toFixed(4)}_${bbox.east.toFixed(4)}`
  if (extraKey === undefined) return base
  const escaped = extraKey.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
  return `${base}|${escaped}`
}

/**
 * Create a debounce cache with the given TTL (in seconds) and entry limit.
 * `ttlSeconds <= 0` disables the cache: `get` always calls `fetch`.
 *
 * The cache wraps `LRUCache` with its built-in `ttl` option so per-entry
 * expiry, eviction, and size accounting all happen inside one library
 * with no per-entry wrapper object of our own.
 */
export function createBboxDebounceCache<T extends NonNullable<unknown>> (
  ttlSeconds: number,
  maxEntries: number
): BboxDebounceCache<T> {
  const ttlMs = Math.max(0, ttlSeconds) * 1000
  // ttl: 0 would tell LRUCache to keep entries forever, which is the
  // opposite of what `ttlSeconds <= 0` means in this module's contract.
  // So when ttlSeconds is the off sentinel, build a 1-entry cache that we
  // never read from and short-circuit `get` to always call the fetcher.
  // The cache holds the in-flight fetch promise, not just its resolved value,
  // so a refresh burst that requests the same bbox before the first fetch
  // settles collapses into one upstream round-trip rather than N.
  const cache = ttlMs > 0
    ? new LRUCache<string, Promise<T>>({ max: maxEntries, ttl: ttlMs })
    : null
  return {
    get: async (bbox, fetch, extraKey) => {
      if (cache === null) {
        return await fetch()
      }
      const key = bboxKey(bbox, extraKey)
      const hit = cache.get(key)
      if (hit !== undefined) {
        return await hit
      }
      const pending = fetch()
      cache.set(key, pending)
      try {
        return await pending
      } catch (error) {
        // Evict the rejected promise so the next call retries upstream rather
        // than replaying the failure for the rest of the TTL.
        if (cache.get(key) === pending) cache.delete(key)
        throw error
      }
    },
    clear: () => { cache?.clear() }
  }
}
