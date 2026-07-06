/**
 * The canonical length conversions, shared wherever a length crosses between
 * unit systems: the OpenSeaMap input (parsing OSM `maxheight` / clearance tags,
 * which may be tagged in feet or feet-and-inches), the ActiveCaptain input
 * (converting `bridgeHeight` when its `distanceUnit` is feet), the dedupe-radius
 * default (150 feet), the panel's display-unit conversions, and the
 * nautical-mile distances the route-corridor module works in.
 * Defining each factor once keeps every consumer from drifting. Dependency-free
 * and browser-safe.
 */

/** Meters in one international foot. Exact by definition. */
export const METERS_PER_FOOT = 0.3048

/** Meters in one kilometer. */
export const METERS_PER_KM = 1000

/** Meters in one international nautical mile. Exact by definition. */
export const METERS_PER_NAUTICAL_MILE = 1852

/**
 * Meters per degree of latitude, and of longitude at the equator. A spherical
 * approximation, good to a fraction of a percent at the leg and grid scales this
 * plugin works at. Shared so the planar projection lives once.
 */
export const METERS_PER_DEGREE = 111_320

/** Convert a length in feet to meters. */
export function metersFromFeet (feet: number): number {
  return feet * METERS_PER_FOOT
}

/** Convert a length in feet and inches to meters. */
export function metersFromFeetInches (feet: number, inches: number): number {
  return metersFromFeet(feet + inches / 12)
}
