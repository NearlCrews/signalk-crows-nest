/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Geographic helpers for the signalk-activecaptain-resources plugin.
 *
 * This module turns a centre point plus a search radius into a bounding box
 * suitable for the ActiveCaptain bounding-box list endpoint.
 *
 * It works only with the typed `Position` and `Bbox` objects from `./types`.
 * Parsing the raw SignalK `ResourceProviderMethods.listResources` query into a
 * centre `Position` and a distance is the job of `resourceQuery.ts`; that
 * module supports the `position` plus `distance` form the chart plotter sends.
 */

import type { Position, Bbox } from './types.js'

/** Mean radius of the Earth in kilometres, used for great-circle estimates. */
const EARTH_RADIUS_KM = 6371

/** Compass bearing (degrees) from the centre toward the north-west corner. */
const NW_BEARING_DEGREES = -45

/** Compass bearing (degrees) from the centre toward the south-east corner. */
const SE_BEARING_DEGREES = 135

function toRadians (degrees: number): number {
  return (degrees * Math.PI) / 180
}

function toDegrees (radians: number): number {
  return (radians * 180) / Math.PI
}

/**
 * Wrap a longitude in degrees into the canonical [-180, 180) range.
 *
 * A great-circle projection near the antimeridian can produce a longitude
 * outside that range (for example 181 degrees). SignalK and the ActiveCaptain
 * API both expect normalised longitudes, so the projected value is wrapped.
 */
function normalizeLongitude (longitude: number): number {
  return ((longitude + 540) % 360) - 180
}

/**
 * Project a position along a great-circle path.
 *
 * Given a start point, an initial compass bearing, and a distance, this
 * returns the destination point using the standard great-circle (spherical
 * Earth) destination formula.
 *
 * @param position - The start point.
 * @param bearingDegrees - Initial bearing in degrees (0 = north, 90 = east).
 * @param distanceKm - Distance to travel in kilometres.
 * @returns The destination position.
 */
function projectPosition (position: Position, bearingDegrees: number, distanceKm: number): Position {
  const latitudeRad = toRadians(position.latitude)
  const longitudeRad = toRadians(position.longitude)
  const bearingRad = toRadians(bearingDegrees)
  const angularDistance = distanceKm / EARTH_RADIUS_KM

  // Clamp into [-1, 1] before asin: floating-point error can push this a hair
  // past the limit for a centre extremely close to a pole, and Math.asin of an
  // out-of-range value is NaN.
  const sineNewLatitude =
    Math.sin(latitudeRad) * Math.cos(angularDistance) +
    Math.cos(latitudeRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  const newLatitudeRad = Math.asin(Math.min(1, Math.max(-1, sineNewLatitude)))

  const newLongitudeRad =
    longitudeRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latitudeRad),
      Math.cos(angularDistance) - Math.sin(latitudeRad) * Math.sin(newLatitudeRad)
    )

  return {
    latitude: toDegrees(newLatitudeRad),
    longitude: normalizeLongitude(toDegrees(newLongitudeRad))
  }
}

/**
 * Build a bounding box centred on a position.
 *
 * The box is derived by projecting the centre point along two great-circle
 * paths: one toward the north-west corner (bearing -45 degrees) and one toward
 * the south-east corner (bearing 135 degrees). The north-west projection
 * supplies the box's `north` and `west` edges, and the south-east projection
 * supplies the `south` and `east` edges. The two corners are diagonally
 * opposite, so `distanceMeters` is the distance from the centre to each
 * corner, not the width of the box.
 *
 * Note: the legacy implementation returned a positional array
 * `[west, north, east, south]` and indexed the input position as
 * `[longitude, latitude]`. This typed version takes a `Position` object and
 * returns a `Bbox` object instead.
 *
 * @param position - The centre of the bounding box.
 * @param distanceMeters - Distance in metres from the centre to each corner.
 * @returns A `Bbox` with `north`, `south`, `east`, and `west` edges in degrees.
 */
export function positionToBbox (position: Position, distanceMeters: number): Bbox {
  const distanceKm = distanceMeters / 1000
  const northWest = projectPosition(position, NW_BEARING_DEGREES, distanceKm)
  const southEast = projectPosition(position, SE_BEARING_DEGREES, distanceKm)

  return {
    north: northWest.latitude,
    south: southEast.latitude,
    east: southEast.longitude,
    west: northWest.longitude
  }
}
