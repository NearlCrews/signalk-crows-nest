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

/**
 * Width of a longitude interval in degrees, following its declared direction.
 *
 * An ordinary box has `west <= east`. An antimeridian-crossing box has
 * `west > east`, so its interval continues through 180 and resumes at -180.
 * The explicit `[-180, 180]` interval is the full world, while `[180, -180]`
 * is the zero-width antimeridian point.
 */
export function longitudeSpanDegrees (west: number, east: number): number {
  if (!Number.isFinite(west) || !Number.isFinite(east)) return Number.NaN
  return east >= west ? east - west : 360 - west + east
}
