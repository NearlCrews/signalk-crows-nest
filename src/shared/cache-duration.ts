/**
 * Default ActiveCaptain POI-detail cache duration, in minutes. Browser-safe
 * (dependency-free) so the panel's normalize-config and the ActiveCaptain input
 * module both import the one value rather than each keeping a hand-synced copy,
 * mirroring the rating.ts / proximity-radius.ts shared-default pattern. Kept
 * separate from cache.ts, which holds the in-memory entry-count ceilings.
 */
export const DEFAULT_CACHE_DURATION_MINUTES = 60
