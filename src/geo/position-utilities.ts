/**
 * Geographic helpers for the signalk-crows-nest plugin.
 *
 * This module turns a center point plus a search radius into a bounding box
 * suitable for the ActiveCaptain bounding-box list endpoint, and measures the
 * great-circle distance between two positions for the proximity alarms.
 *
 * It works only with the typed `Position` and `Bbox` objects from
 * `../shared/types.js`. Parsing the raw SignalK
 * `ResourceProviderMethods.listResources` query into a center `Position` and a
 * distance is the job of `src/outputs/notes-resource/resource-query.ts`; that
 * module supports the `position` plus `distance` form the chart plotter sends.
 */

import { toFiniteNumber } from '../shared/numbers.js'
import type { Position, Bbox } from '../shared/types.js'

/** Mean radius of the Earth in kilometers, used for great-circle estimates. */
const EARTH_RADIUS_KM = 6371

/** Compass bearing (degrees) from the center toward the north-west corner. */
const NW_BEARING_DEGREES = -45

/** Compass bearing (degrees) from the center toward the south-east corner. */
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
 * API both expect normalized longitudes, so the projected value is wrapped.
 */
function normalizeLongitude (longitude: number): number {
  return ((longitude + 540) % 360) - 180
}

/**
 * Narrow an unknown value into a `Position`, or return `null` when it is not a
 * usable latitude/longitude pair. A position value can briefly be null (no
 * fix), so this guards rather than trusting the shape. Shared by the position
 * monitor and the course reader, both of which read positions off SignalK
 * deltas and the data model.
 */
export function toPosition (value: unknown): Position | null {
  if (value === null || typeof value !== 'object') {
    return null
  }
  const { latitude, longitude } = value as Record<string, unknown>
  const lat = toFiniteNumber(latitude)
  const lon = toFiniteNumber(longitude)
  if (lat === null || lon === null) {
    return null
  }
  return { latitude: lat, longitude: lon }
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
 * @param distanceKm - Distance to travel in kilometers.
 * @returns The destination position.
 */
function projectPosition (position: Position, bearingDegrees: number, distanceKm: number): Position {
  const latitudeRad = toRadians(position.latitude)
  const longitudeRad = toRadians(position.longitude)
  const bearingRad = toRadians(bearingDegrees)
  const angularDistance = distanceKm / EARTH_RADIUS_KM

  // Clamp into [-1, 1] before asin: floating-point error can push this a hair
  // past the limit for a center extremely close to a pole, and Math.asin of an
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
 * Great-circle distance between two positions, in meters.
 *
 * Uses the haversine formula on a spherical Earth. Accuracy is well within a
 * fraction of a percent at the short ranges this plugin works with (a hazard
 * within a few hundred meters of the vessel), which is far better than the
 * positional accuracy of the underlying ActiveCaptain data.
 *
 * @param a - The first position.
 * @param b - The second position.
 * @returns The distance between the two positions in meters.
 */
export function distanceMeters (a: Position, b: Position): number {
  const latitudeA = toRadians(a.latitude)
  const latitudeB = toRadians(b.latitude)
  const deltaLatitude = toRadians(b.latitude - a.latitude)
  const deltaLongitude = toRadians(b.longitude - a.longitude)

  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2
  // Clamp before asin's companion: floating-point error can push the argument
  // a hair past 1 for two near-identical positions, and Math.sqrt of a tiny
  // negative is NaN.
  const angularDistance = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))

  return EARTH_RADIUS_KM * 1000 * angularDistance
}

/**
 * Build a bounding box that fully encloses a search circle.
 *
 * `distanceMeters` is the search radius: every point within that radius of the
 * center must fall inside the returned box. The box is derived by projecting
 * the center toward the north-west corner (bearing -45 degrees) and the
 * south-east corner (bearing 135 degrees). To make each cardinal edge sit at
 * least `distanceMeters` from the center, the corners are projected at
 * `distanceMeters * sqrt(2)` (a corner of a square is that much further from
 * the center than an edge). Projecting the corners at only `distanceMeters`
 * would inscribe the box inside the circle and silently drop points that lie
 * within the radius but near due north, south, east, or west.
 *
 * Note: the legacy implementation returned a positional array
 * `[west, north, east, south]` and indexed the input position as
 * `[longitude, latitude]`. This typed version takes a `Position` object and
 * returns a `Bbox` object instead.
 *
 * Known limitation: this function is not antimeridian-aware. When the search
 * circle straddles +/-180 degrees longitude the projected `west` edge ends up
 * numerically greater than the `east` edge, so a downstream consumer that
 * assumes `west <= east` builds the wrong (inside-out) box. This affects only
 * vessels operating right at the 180 degree meridian; a correct fix would have
 * to split the box in two, which is deliberately out of scope here.
 *
 * @param position - The center of the bounding box.
 * @param distanceMeters - Search radius in meters that the box must enclose.
 * @returns A `Bbox` with `north`, `south`, `east`, and `west` edges in degrees.
 */
export function positionToBbox (position: Position, distanceMeters: number): Bbox {
  // Corner-to-center distance for a square whose edges sit distanceMeters out.
  const cornerDistanceKm = (distanceMeters * Math.SQRT2) / 1000
  const northWest = projectPosition(position, NW_BEARING_DEGREES, cornerDistanceKm)
  const southEast = projectPosition(position, SE_BEARING_DEGREES, cornerDistanceKm)

  return {
    north: northWest.latitude,
    south: southEast.latitude,
    east: southEast.longitude,
    west: northWest.longitude
  }
}

/**
 * Initial great-circle bearing from `a` to `b`, in radians.
 *
 * Zero is due north and the angle increases clockwise, matching the compass
 * convention `projectPosition` uses. This is the forward azimuth as the path
 * leaves `a`; on a great circle the bearing changes along the path, so it is
 * only correct at the start point.
 */
function initialBearingRad (a: Position, b: Position): number {
  const latitudeA = toRadians(a.latitude)
  const latitudeB = toRadians(b.latitude)
  const deltaLongitude = toRadians(b.longitude - a.longitude)

  const y = Math.sin(deltaLongitude) * Math.cos(latitudeB)
  const x =
    Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(deltaLongitude)
  return Math.atan2(y, x)
}

/**
 * The projection of a point onto a great-circle leg.
 *
 * `crossTrackMeters` is the signed perpendicular distance from the point to
 * the leg's great circle: positive when the point lies to the right of the
 * leg in the direction of travel, negative to the left. `alongTrackMeters` is
 * the distance from the leg's start point to the foot of that perpendicular,
 * measured along the leg; it is negative when the foot lies behind the start
 * and exceeds the leg length when the foot lies beyond the end.
 */
export interface TrackProjection {
  crossTrackMeters: number
  alongTrackMeters: number
}

/**
 * Project a point onto a great-circle leg.
 *
 * Uses the standard cross-track and along-track distance formulae on a
 * spherical Earth. The leg is the great-circle segment from `start` to `end`.
 * The caller decides whether the point is inside a corridor by comparing the
 * returned distances against the corridor width and the leg length.
 *
 * A zero-length leg (`start` equal to `end`) has no defined direction; the
 * caller should skip such a leg rather than rely on this result.
 *
 * @param start - The leg's start point.
 * @param end - The leg's end point.
 * @param point - The point to project onto the leg.
 * @returns The signed cross-track and along-track distances, in meters.
 */
export function projectPointOntoLeg (start: Position, end: Position, point: Position): TrackProjection {
  const radiusMeters = EARTH_RADIUS_KM * 1000
  const angularDistanceToPoint = distanceMeters(start, point) / radiusMeters
  const bearingToPoint = initialBearingRad(start, point)
  const bearingToEnd = initialBearingRad(start, end)

  // Clamp before asin: floating-point error can push the product a hair past
  // the [-1, 1] range, and Math.asin of an out-of-range value is NaN.
  const crossTrackAngular = Math.asin(
    Math.min(1, Math.max(-1, Math.sin(angularDistanceToPoint) * Math.sin(bearingToPoint - bearingToEnd)))
  )

  // The along-track angle is acos(cos(d13) / cos(dxt)). Math.acos yields a
  // value in [0, pi], so it is always non-negative. The sign is recovered
  // from the bearing delta: a point more than 90 degrees off the leg bearing
  // lies behind the start, so its along-track distance is negative.
  const alongTrackRatio = Math.cos(angularDistanceToPoint) / Math.cos(crossTrackAngular)
  const alongTrackAngular = Math.acos(Math.min(1, Math.max(-1, alongTrackRatio)))
  const directionSign = Math.cos(bearingToPoint - bearingToEnd) >= 0 ? 1 : -1

  return {
    crossTrackMeters: crossTrackAngular * radiusMeters,
    alongTrackMeters: directionSign * alongTrackAngular * radiusMeters
  }
}

/**
 * The smallest bounding box that encloses both inputs.
 *
 * Known limitation: this function is not antimeridian-aware. It takes the
 * min/max of each edge, so two boxes on opposite sides of the +/-180 degree
 * meridian union into one box spanning the long way around the globe instead
 * of the short way across the meridian. This affects only vessels operating
 * right at the 180 degree meridian; a correct fix would have to detect the
 * wrap and is deliberately out of scope here.
 */
export function unionBbox (a: Bbox, b: Bbox): Bbox {
  return {
    north: Math.max(a.north, b.north),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    west: Math.min(a.west, b.west)
  }
}
