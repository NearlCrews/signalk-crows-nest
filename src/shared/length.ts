/**
 * The canonical length conversions, shared wherever a length crosses between
 * unit systems: the OpenSeaMap input (parsing OSM `maxheight` / clearance tags,
 * which may be tagged in feet or feet-and-inches), the ActiveCaptain input
 * (converting `bridgeHeight` when its `distanceUnit` is feet), the dedupe-radius
 * default (150 feet), the panel's display-unit conversions, and the
 * nautical-mile distances the route-corridor and route-draft modules work in.
 * Defining each factor once keeps every consumer from drifting. Dependency-free
 * and browser-safe.
 */

/** Meters in one international foot. Exact by definition. */
export const METERS_PER_FOOT = 0.3048

/** Meters in one international nautical mile. Exact by definition. */
export const METERS_PER_NAUTICAL_MILE = 1852

/** Convert a length in feet to meters. */
export function metersFromFeet (feet: number): number {
  return feet * METERS_PER_FOOT
}

/** Convert a length in feet and inches to meters. */
export function metersFromFeetInches (feet: number, inches: number): number {
  return metersFromFeet(feet + inches / 12)
}

/** Convert a distance in nautical miles to meters. */
export function metersFromNauticalMiles (nauticalMiles: number): number {
  return nauticalMiles * METERS_PER_NAUTICAL_MILE
}
