/**
 * Canonical bounds, per-source defaults, clamp, and config-schema fragment for
 * the per-source bbox-debounce refresh window, in seconds.
 *
 * These live in their own dependency-free module (it imports only the
 * browser-safe `clampNumber` and `boundedNumberSchema`) so the React panel can
 * pull the bounds without dragging the node-only `lru-cache` dependency that the
 * cache implementation in `bbox-debounce.ts` carries into the browser bundle.
 * This mirrors every sibling bounds module (`rating.ts`, `year-filter.ts`,
 * `refresh-hours.ts`, `cache-duration.ts`, `proximity-radius.ts`,
 * `route-corridor.ts`, `dedupe-radius.ts`), each deliberately dependency-free so
 * the source module and the panel's normalize-config cannot drift on a bound.
 * The cache implementation that consumes these lives in `bbox-debounce.ts`.
 *
 * The same bounds also govern the periodic bulk-refresh cadence of the USCG
 * LNM source, which reuses the refresh-seconds config field; see
 * {@link effectivePeriodicRefreshSeconds} for that interpretation, where `0`
 * means the default cadence rather than "no caching".
 */

import { clampNumber } from './numbers.js'
import { boundedNumberSchema } from './config-schema.js'

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
 * Default refresh window for the USCG Local Notice to Mariners source: 15
 * minutes, NAVCEN's own publication cadence for the LNM GeoJSON files. For
 * this source the value is a periodic bulk-refresh interval rather than a
 * per-viewport debounce, so the input treats a configured `0` as "use the
 * default" instead of "no caching".
 */
export const DEFAULT_USCG_LNM_DEBOUNCE_SECONDS = 900

/**
 * Default debounce window for the USACE locks and dams source: 30 minutes.
 * Lock and dam structures change on an engineering timescale, so this matches
 * the NOAA ENC window rather than the dynamic ActiveCaptain one.
 */
export const DEFAULT_USACE_DEBOUNCE_SECONDS = 1800

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
 * Resolve the effective periodic bulk-refresh cadence, in seconds, for an input
 * that reuses the bbox-debounce bounds as a background re-download interval
 * rather than a per-viewport window. The value is clamped to the shared bounds,
 * then a clamped `0` (the off sentinel for a per-viewport cache) or any
 * non-positive value falls back to the given default, since a periodic refresh
 * cannot run on a zero-second interval. Shared by the USCG LNM input's
 * millisecond conversion and the panel's normalize-config so the two cannot
 * drift on the zero-to-default rule.
 */
export function effectivePeriodicRefreshSeconds (raw: unknown, fallback: number): number {
  const seconds = clampBboxDebounceSeconds(raw, fallback)
  return seconds > 0 ? seconds : fallback
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
