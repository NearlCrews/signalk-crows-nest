/**
 * Cache-sizing constants shared by the plugin's POI caches.
 *
 * Both the ActiveCaptain and the OpenSeaMap source keep an in-memory cache of
 * detail responses keyed by POI id. The at-runtime sources (NOAA ENC,
 * OpenSeaMap) additionally keep a small bbox-debounce cache so a
 * Freeboard-refresh burst on the same viewport does not flood the upstream.
 * The ceilings live here so every source agrees on the same numbers.
 */

/** Hard ceiling on entries in a POI detail cache, guarding memory on long sessions. */
export const MAX_POI_CACHE_ENTRIES = 5000

/**
 * Hard ceiling on entries in the per-source bbox-debounce cache. Chart
 * plotters cycle through a small handful of viewports at once (the rendered
 * map view plus a few zoom-out parents), so 16 entries is plenty; the LRU
 * evicts the oldest if the user really pans through more.
 */
export const MAX_BBOX_CACHE_ENTRIES = 16
