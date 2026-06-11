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
 * This module also owns the canonical refresh-period bounds, the per-source
 * defaults, and the clamp helper (`MIN_BBOX_DEBOUNCE_SECONDS`,
 * `MAX_BBOX_DEBOUNCE_SECONDS`, `DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS`,
 * `DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS`, `DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS`,
 * `clampBboxDebounceSeconds`). Each input module's config-schema fragment
 * and the panel's normalize-config use them, so a change to the bounds is
 * one edit, not four.
 */

import { LRUCache } from 'lru-cache'
import { clampNumber } from './numbers.js'
import { boundedNumberSchema } from './config-schema.js'
import { MS_PER_SECOND } from './time.js'
import type { Bbox } from './types.js'

/**
 * Default per-bbox debounce window for the ActiveCaptain source, in seconds.
 * ActiveCaptain is the most dynamic upstream (reviews and hazard reports
 * arrive continuously), so its window stays short; the per-source defaults
 * below stretch with each upstream's real data volatility. The
 * stale-while-revalidate design means a longer window has no latency cost: a
 * stale tile is served instantly either way, and the window only governs how
 * often the background revalidation re-queries upstream.
 */
export const DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS = 30

/**
 * Default debounce window for the OpenSeaMap source: 10 minutes. OSM seamark
 * edits trickle in at a rate where a sub-minute revalidation buys nothing,
 * and the Overpass mirrors are shared community infrastructure worth
 * sparing.
 */
export const DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS = 600

/**
 * Default debounce window for the NOAA ENC Direct source: 30 minutes. NOAA
 * refreshes ENC data weekly, so revalidating a viewport more often than this
 * only re-downloads identical wrecks and rocks from the ArcGIS service.
 */
export const DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS = 1800

/**
 * Smallest configurable value. `0` is the off sentinel (no caching), so the
 * minimum below the off sentinel does not exist; the minimum is itself `0`.
 */
export const MIN_BBOX_DEBOUNCE_SECONDS = 0

/**
 * Largest configurable value: one hour. POI data is nearly static, so a long
 * window is legitimate; the cap only protects against a hand-edited config
 * value that would effectively disable upstream querying for a whole voyage.
 */
export const MAX_BBOX_DEBOUNCE_SECONDS = 3600

/**
 * Clamp a raw refresh-seconds value into the supported range, falling back
 * to the given per-source default on any non-numeric or non-finite input.
 * The fallback is required so a new call site must say which source's
 * default it means; a silent shared default let one layer inherit 30 s
 * while another resolved 600 s with no compile error.
 */
export function clampBboxDebounceSeconds (raw: unknown, fallback: number): number {
  return clampNumber(raw, MIN_BBOX_DEBOUNCE_SECONDS, MAX_BBOX_DEBOUNCE_SECONDS, fallback, true)
}

/**
 * Config-schema fragment for a source's bbox-debounce window field, in seconds.
 * The at-runtime sources (ActiveCaptain, OpenSeaMap, NOAA ENC) each declare an
 * identical number field over the debounce bounds, differing only in its title
 * and per-source default, so the shape lives here next to the bounds it
 * carries.
 */
export function refreshSecondsSchema (title: string, defaultSeconds: number): Record<string, unknown> {
  return boundedNumberSchema(
    title, defaultSeconds, MIN_BBOX_DEBOUNCE_SECONDS, MAX_BBOX_DEBOUNCE_SECONDS
  )
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

/**
 * How close (in degrees) a requested edge must sit to its snapped tile edge
 * before the neighbor tile in that direction is prefetched. 0.02 degrees is
 * 0.2 cells, about 2.2 km: far enough out that a vessel underway (or a
 * steady pan) warms the next tile before crossing the grid line, close
 * enough that a centered viewport prefetches nothing. The distance must be
 * strictly positive: an exactly grid-aligned edge carries no direction
 * information, so a stationary aligned viewport prefetches nothing.
 */
const PREFETCH_MARGIN_DEGREES = 0.02

/** One grid cell, in degrees. */
const CELL_DEGREES = 1 / SNAP_CELLS_PER_DEGREE

/**
 * Largest snapped span (per axis, in cells) that still prefetches. The
 * prefetch fetches the whole viewport translated one cell, so for a wide
 * zoomed-out chart view it would re-download nearly everything on screen to
 * gain one thin strip; the warming only pays for the small vessel-centered
 * scan boxes and close-zoom views the cliff actually hurts.
 */
const PREFETCH_MAX_SPAN_CELLS = 2

/** Translate a bbox by the given cell offsets (east-positive, north-positive). */
function translateBbox (bbox: Bbox, eastCells: number, northCells: number): Bbox {
  const east = eastCells * CELL_DEGREES
  const north = northCells * CELL_DEGREES
  return {
    south: bbox.south + north,
    west: bbox.west + east,
    north: bbox.north + north,
    east: bbox.east + east
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

/** Optional knobs for {@link createBboxDebounceCache}. */
export interface BboxDebounceCacheOptions {
  /** Clock source, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
  /**
   * Warm the neighbor tile in the background when a request approaches a
   * snapped tile edge (see the prefetch note on `get`). On by default so a
   * vessel underway crosses the grid cliff onto an already-warm tile; tests
   * that assert exact fetch counts opt out.
   */
  prefetchNeighbors?: boolean
}

/**
 * Create a geographic stale-while-revalidate cache with the given freshness
 * window (in seconds) and entry limit. `ttlSeconds <= 0` disables the cache:
 * `get` always fetches the raw viewport.
 *
 * The LRU bounds size only (no library `ttl`): a stale tile must remain
 * readable so it can be served while it revalidates, so freshness is tracked
 * per entry against `now`.
 */
export function createBboxDebounceCache<T extends NonNullable<unknown>> (
  ttlSeconds: number,
  maxEntries: number,
  options: BboxDebounceCacheOptions = {}
): BboxDebounceCache<T> {
  const now = options.now ?? Date.now
  const prefetchEnabled = options.prefetchNeighbors !== false
  const ttlMs = Math.max(0, ttlSeconds) * MS_PER_SECOND
  const cache = ttlMs > 0
    ? new LRUCache<string, GeoEntry<T>>({ max: maxEntries })
    : null

  // Start a fetch, store it as the tile's entry, and wire up resolve/reject: a
  // resolved value stamps the entry fresh (and is dropped when vetoed); a
  // rejection evicts the entry so the next call retries rather than replaying
  // the failure.
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

  // Edge-proximity prefetch: when the requested box sits within the margin
  // of a snapped tile edge, warm the neighbor tile in that direction in the
  // background. A vessel underway (or a steady pan) pushes its viewport
  // toward an edge before crossing it, so the grid-cliff cold fetch on the
  // far side, which would otherwise block exactly the proximity-alarm scan
  // path, lands on an already-warm tile instead. Runs only when serving a
  // warm tile (never on a cold miss), so a rate-limited upstream sees at
  // most one neighbor fetch per approach, not a burst.
  function prefetchNeighbors (
    bbox: Bbox,
    fetchBbox: Bbox,
    fetch: (fetchBbox: Bbox) => Promise<T>,
    extraKey?: string,
    shouldCache?: (value: T) => boolean
  ): void {
    // Wide viewports skip the warmup entirely (see PREFETCH_MAX_SPAN_CELLS).
    const maxSpan = PREFETCH_MAX_SPAN_CELLS * CELL_DEGREES
    if (fetchBbox.east - fetchBbox.west > maxSpan || fetchBbox.north - fetchBbox.south > maxSpan) {
      return
    }
    // Scalar edge distances, checked before any allocation: the common case
    // (no edge in range) costs arithmetic only, on a path that runs on every
    // warm chart refresh and monitor tick.
    const eastDistance = fetchBbox.east - bbox.east
    const westDistance = bbox.west - fetchBbox.west
    const northDistance = fetchBbox.north - bbox.north
    const southDistance = bbox.south - fetchBbox.south
    const nearEast = eastDistance > 0 && eastDistance < PREFETCH_MARGIN_DEGREES
    const nearWest = westDistance > 0 && westDistance < PREFETCH_MARGIN_DEGREES
    const nearNorth = northDistance > 0 && northDistance < PREFETCH_MARGIN_DEGREES
    const nearSouth = southDistance > 0 && southDistance < PREFETCH_MARGIN_DEGREES
    if (!nearEast && !nearWest && !nearNorth && !nearSouth) {
      return
    }
    // Rare path: build the qualifying candidates and warm the two nearest (a
    // vessel approaches one edge, or a corner).
    const near: Array<{ eastCells: number, northCells: number, distance: number }> = []
    if (nearEast) near.push({ eastCells: 1, northCells: 0, distance: eastDistance })
    if (nearWest) near.push({ eastCells: -1, northCells: 0, distance: westDistance })
    if (nearNorth) near.push({ eastCells: 0, northCells: 1, distance: northDistance })
    if (nearSouth) near.push({ eastCells: 0, northCells: -1, distance: southDistance })
    near.sort((a, b) => a.distance - b.distance)
    for (const { eastCells, northCells } of near.slice(0, 2)) {
      const neighbor = snapBbox(translateBbox(bbox, eastCells, northCells))
      const key = bboxKey(neighbor, extraKey)
      // `peek` rather than `get`: a mere proximity check must not bump the
      // neighbor's LRU recency and shield an idle tile from eviction.
      if (cache?.peek(key) !== undefined) continue
      // Fire and forget; fetchInto already evicts the entry on rejection so
      // a failed prefetch costs nothing and the real crossing just fetches.
      fetchInto(key, neighbor, fetch, shouldCache).promise.catch(() => {})
    }
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
        if (prefetchEnabled) {
          prefetchNeighbors(bbox, fetchBbox, fetch, extraKey, shouldCache)
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
