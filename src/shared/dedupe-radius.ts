/**
 * Default merge radius, in meters, for deduplicating a non-base source's POIs
 * against the ActiveCaptain base, and as the fallback for each non-base source
 * (OpenSeaMap, USCG Light List, and NOAA ENC) when its own radius is unusable.
 * Browser-safe (dependency-free) so the panel's normalize-config and the dedupe
 * module both import the one value, mirroring the rating.ts shared-default
 * pattern. Named for what it is (a dedupe radius), not for one of the sources
 * that uses it.
 */
export const DEFAULT_DEDUPE_RADIUS_METERS = 150
