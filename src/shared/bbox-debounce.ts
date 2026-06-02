/**
 * Per-source geographic stale-while-revalidate cache for POI sources.
 *
 * Every source hits its upstream on every `listPointsOfInterest` call. The
 * position-monitor scan path is throttled at the monitor, but the chart-display
 * path through the notes-resource output is one upstream request per chart
 * refresh, and a pan or zoom to a new viewport is a fresh request. This cache
 * cuts the delay two ways:
 *
 * - Snapping: each viewport is snapped OUTWARD to a coarse tile grid
 *   (0.1 degrees, about 11 km) and keyed on the snapped tile, so a small pan
 *   that stays inside a tile reuses the previous fetch instead of querying
 *   upstream again. The fetcher receives the snapped tile, a superset of the
 *   viewport, which is safe because the notes output never clips to the
 *   requested box. The trade-off is a "grid cliff": a pan that crosses a tile
 *   line misses. The grid is a fixed size (viewport-span-agnostic): a zoomed-in
 *   view still fetches a whole tile and a zoomed-out view snaps to the
 *   enclosing tiles; a zoom-adaptive grid is a possible future refinement.
 * - Stale-while-revalidate: a tile past its freshness window is returned
 *   immediately and refreshed in the background, so only a genuinely new tile
 *   blocks on upstream. POIs change slowly, so serving a slightly stale tile
 *   for a tick is harmless. There is no max-stale ceiling: a tile whose
 *   refresh keeps failing is served indefinitely, which is the intended trade
 *   for slow-changing POI data.
 *
 * Off-sentinel matches the rest of the codebase: `ttlSeconds <= 0` disables the
 * cache, and the raw viewport (no snap) is fetched on every call. The freshness
 * window is in seconds because the typical chart-plotter cadence is sub-minute.
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
import { clampNumber } from './numbers.js'
import { MS_PER_SECOND } from './time.js'
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
  return clampNumber(raw, MIN_BBOX_DEBOUNCE_SECONDS, MAX_BBOX_DEBOUNCE_SECONDS, DEFAULT_BBOX_DEBOUNCE_SECONDS, true)
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
 * A geographic stale-while-revalidate cache. `get` snaps the viewport to a
 * coarse tile, serves a fresh tile as-is, serves a stale tile immediately while
 * revalidating it in the background, and fetches (blocking) only on a genuine
 * miss. The value type is generic so each source caches its own shape.
 */
export interface BboxDebounceCache<T> {
  /**
   * Return POIs for `bbox`. The cache snaps `bbox` outward to a tile grid and
   * keys on the snapped tile (plus the optional `extraKey`), so a small pan
   * inside the tile hits. `fetch` receives the SNAPPED bbox to query upstream;
   * fetching the tile (a superset of the viewport) is safe because the notes
   * output never clips to the requested box.
   *
   * Freshness: a tile younger than the TTL is returned as-is; a stale tile is
   * returned immediately and revalidated in the background; a missing tile is
   * fetched and awaited (the only blocking path), with a concurrent same-tile
   * burst collapsed onto one in-flight fetch.
   *
   * `extraKey` is appended to the key so a source whose upstream filters
   * server-side on a request argument (ActiveCaptain's `poiTypes`) does not let
   * one caller's narrower request poison a later caller's wider one.
   *
   * `shouldCache`, when given, is consulted with the resolved value: if it
   * returns false the value is returned to the caller but not retained, so the
   * next call re-fetches. A source uses it to avoid caching a degraded result
   * (a partial multi-layer response, say).
   */
  get: (
    bbox: Bbox,
    fetch: (fetchBbox: Bbox) => Promise<T>,
    extraKey?: string,
    shouldCache?: (value: T) => boolean
  ) => Promise<T>
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
 * Tile grid resolution, in integer cells per degree. 10 cells = 0.1-degree
 * tiles (about 11 km): coarse enough that a small pan stays in one tile and
 * hits the cache, fine enough that the fetched superset is not far larger than
 * the viewport. Kept as an integer (not the 0.1-degree size) so a snapped edge
 * reconstructs exactly as `cell / SNAP_CELLS_PER_DEGREE`, dodging the float
 * drift of `cell * 0.1`.
 */
const SNAP_CELLS_PER_DEGREE = 10

/**
 * Snap one coordinate to a grid cell boundary with `round` (floor for the
 * south/west edges, ceil for north/east). `coord * 10` carries float noise
 * (`42.0 * 10 === 420.00000000000006`), so the product is rounded to 1e-6 cell
 * precision before floor/ceil; that lands a grid-aligned edge on its own
 * boundary instead of one cell off.
 */
function snapCell (coord: number, round: (n: number) => number): number {
  return round(Number((coord * SNAP_CELLS_PER_DEGREE).toFixed(6)))
}

/**
 * Snap a viewport OUTWARD to the smallest grid-aligned tile that fully contains
 * it. The reconstructed edges are exact multiples of the cell size (division by
 * the integer cells-per-degree), so two viewports in the same tile produce an
 * identical box and therefore an identical cache key.
 */
function snapBbox (bbox: Bbox): Bbox {
  return {
    south: snapCell(bbox.south, Math.floor) / SNAP_CELLS_PER_DEGREE,
    west: snapCell(bbox.west, Math.floor) / SNAP_CELLS_PER_DEGREE,
    north: snapCell(bbox.north, Math.ceil) / SNAP_CELLS_PER_DEGREE,
    east: snapCell(bbox.east, Math.ceil) / SNAP_CELLS_PER_DEGREE
  }
}

/** A cached tile: the in-flight or settled fetch plus its freshness state. */
interface GeoEntry<T> {
  /** The fetch promise; awaited by concurrent callers during a cold miss. */
  promise: Promise<T>
  /** The resolved value, undefined until the fetch first succeeds. */
  value: T | undefined
  /** Clock time the value resolved, compared against the freshness window. */
  freshAt: number
  /** True once the fetch has resolved successfully. */
  ok: boolean
  /** True while a background revalidation of this tile is in flight. */
  revalidating: boolean
}

/**
 * Create a geographic stale-while-revalidate cache with the given freshness
 * window (in seconds) and entry limit. `ttlSeconds <= 0` disables the cache:
 * `get` always fetches the raw viewport. `now` is injectable for tests.
 *
 * The LRU bounds size only (no library `ttl`): a stale tile must remain
 * readable so it can be served while it revalidates, so freshness is tracked
 * per entry against `now`.
 */
export function createBboxDebounceCache<T extends NonNullable<unknown>> (
  ttlSeconds: number,
  maxEntries: number,
  now: () => number = Date.now
): BboxDebounceCache<T> {
  const ttlMs = Math.max(0, ttlSeconds) * MS_PER_SECOND
  const cache = ttlMs > 0
    ? new LRUCache<string, GeoEntry<T>>({ max: maxEntries })
    : null

  // Start a fetch, store it as the tile's entry, and wire up resolve/reject: a
  // resolved value stamps the entry fresh (and is dropped when vetoed); a
  // rejection evicts the entry so the next call retries rather than replaying
  // the failure. The promise is built before the entry so its callbacks can
  // close over the entry they update.
  function fetchInto (
    key: string,
    fetchBbox: Bbox,
    fetch: (fetchBbox: Bbox) => Promise<T>,
    shouldCache?: (value: T) => boolean
  ): GeoEntry<T> {
    // The promise is assigned just after the entry is built so its callbacks
    // can close over the entry they update; the placeholder is overwritten at
    // once on the next statement.
    const entry: GeoEntry<T> = {
      promise: undefined as unknown as Promise<T>,
      value: undefined,
      freshAt: 0,
      ok: false,
      revalidating: false
    }
    entry.promise = fetch(fetchBbox)
      .then((value) => {
        entry.value = value
        entry.freshAt = now()
        entry.ok = true
        if (shouldCache !== undefined && !shouldCache(value) && cache?.get(key) === entry) {
          cache.delete(key)
        }
        return value
      })
      .catch((error: unknown) => {
        if (cache?.get(key) === entry) cache.delete(key)
        throw error
      })
    cache?.set(key, entry)
    return entry
  }

  // Refresh a stale tile in the background, updating the live entry in place so
  // concurrent stale reads keep serving the old value until the refresh lands.
  // A transient failure leaves the stale entry to be retried on a later read.
  function revalidate (
    key: string,
    fetchBbox: Bbox,
    fetch: (fetchBbox: Bbox) => Promise<T>,
    entry: GeoEntry<T>,
    shouldCache?: (value: T) => boolean
  ): void {
    entry.revalidating = true
    fetch(fetchBbox)
      .then((value) => {
        if (shouldCache !== undefined && !shouldCache(value)) {
          if (cache?.get(key) === entry) cache.delete(key)
          return
        }
        entry.value = value
        entry.freshAt = now()
      })
      .catch(() => { /* keep serving the stale entry; retry on a later read */ })
      .finally(() => { entry.revalidating = false })
  }

  return {
    get: async (bbox, fetch, extraKey, shouldCache) => {
      if (cache === null) {
        return await fetch(bbox)
      }
      const fetchBbox = snapBbox(bbox)
      const key = bboxKey(fetchBbox, extraKey)
      const existing = cache.get(key)
      if (existing !== undefined) {
        if (!existing.ok) {
          // A cold fetch is still in flight: share it (collapse the burst).
          return await existing.promise
        }
        if (now() - existing.freshAt < ttlMs) {
          return existing.value as T
        }
        // Stale: serve the last-known value now, revalidate once in background.
        if (!existing.revalidating) {
          revalidate(key, fetchBbox, fetch, existing, shouldCache)
        }
        return existing.value as T
      }
      return await fetchInto(key, fetchBbox, fetch, shouldCache).promise
    },
    clear: () => { cache?.clear() }
  }
}
