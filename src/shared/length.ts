/**
 * Length-unit conversions shared by the bridge-clearance parsers.
 *
 * Both the OpenSeaMap input (parsing OSM `maxheight` / clearance tags, which
 * may be tagged in feet or feet-and-inches) and the ActiveCaptain input
 * (converting `bridgeHeight` when its `distanceUnit` is feet) need the same
 * foot-to-meter factor. Defining it once here keeps the two parsers from
 * drifting and keeps the conversion out of the comparison module so the
 * browser-bundled panel never pulls it in.
 */

/** Meters in one international foot. Exact by definition. */
export const METERS_PER_FOOT = 0.3048

/** Convert a length in feet to meters. */
export function metersFromFeet (feet: number): number {
  return feet * METERS_PER_FOOT
}

/** Convert a length in feet and inches to meters. */
export function metersFromFeetInches (feet: number, inches: number): number {
  return metersFromFeet(feet + inches / 12)
}
