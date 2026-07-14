/** Longitude normalization shared by projection and wrapped-bbox helpers. */

/**
 * Wrap a finite longitude into the inclusive `[-180, 180]` range. Keeping an
 * exact endpoint at either 180 or -180 preserves the caller's chosen side of
 * the antimeridian, while values beyond the range wrap across it.
 */
export function wrapLongitude (longitude: number): number {
  if (!Number.isFinite(longitude)) return Number.NaN
  if (longitude >= -180 && longitude <= 180) return longitude
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180
  // Preserve the positive spelling of the antimeridian for a positive input.
  return wrapped === -180 && longitude > 0 ? 180 : wrapped
}
