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
 * Hard ceiling on entries in the per-source bbox-debounce cache. At the
 * cache's 0.1-degree tiles a coastal passage crosses a tile roughly every
 * 6 nautical miles, so 64 entries keeps a full day's track (plus the zoom-out
 * parents a chartplotter cycles through) warm instead of evicting the
 * morning's tiles by lunch; each entry is one viewport's summaries, so the
 * ceiling stays a few megabytes at worst. The LRU evicts the oldest if the
 * user pans through more.
 */
export const MAX_BBOX_CACHE_ENTRIES = 64
