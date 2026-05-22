/**
 * Parsing of the loosely typed SignalK resource-provider query into a search
 * bounding box.
 */

import { positionToBbox } from '../../geo/position-utilities.js'
import { toFiniteNumber } from '../../shared/numbers.js'
import type { Bbox, Position } from '../../shared/types.js'

/**
 * Coerce a single loosely typed query component into a finite number, or
 * `null` when it is not.
 *
 * `Number('')`, `Number('  ')`, `Number(null)`, and `Number([])` all yield 0,
 * a finite number, so a blank, whitespace-only, or absent component would
 * otherwise coerce to a real coordinate of 0. A blank component is rejected as
 * not-a-number here; a genuine numeric string, including `"0"`, is accepted.
 */
function parseFiniteNumber (raw: unknown): number | null {
  if (typeof raw === 'string') {
    if (raw.trim() === '') {
      return null
    }
    return toFiniteNumber(Number(raw))
  }
  return toFiniteNumber(raw)
}

/**
 * Normalize a query `position` value into a Position, or null if unusable.
 *
 * SignalK passes the search center either as a `{ latitude, longitude }`
 * object or as a `[longitude, latitude]` array (the order the legacy plugin
 * relied on).
 */
export function resolvePosition (raw: unknown): Position | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const longitude = parseFiniteNumber(raw[0])
    const latitude = parseFiniteNumber(raw[1])
    if (longitude !== null && latitude !== null) {
      return { latitude, longitude }
    }
    return null
  }

  if (raw !== null && typeof raw === 'object') {
    const candidate = raw as Record<string, unknown>
    const latitude = parseFiniteNumber(candidate.latitude)
    const longitude = parseFiniteNumber(candidate.longitude)
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude }
    }
  }

  return null
}

/**
 * Parse an explicit `bbox` query value into a Bbox.
 *
 * The box is four numbers in GeoJSON bounding-box order (RFC 7946),
 * `[minLongitude, minLatitude, maxLongitude, maxLatitude]`, supplied either as
 * an array or as a comma-separated string (with or without surrounding
 * brackets). Returns null when the value is not four finite numbers.
 */
function resolveExplicitBbox (raw: unknown): Bbox | null {
  let parts: unknown[]
  if (typeof raw === 'string') {
    parts = raw.replace(/[[\]\s]/g, '').split(',')
  } else if (Array.isArray(raw)) {
    parts = raw
  } else {
    return null
  }

  if (parts.length !== 4) {
    return null
  }
  const numbers = parts.map(parseFiniteNumber)
  if (numbers.some(value => value === null)) {
    return null
  }
  const [west, south, east, north] = numbers as number[]
  return { west, south, east, north }
}

/**
 * Derive a search bounding box from a SignalK resource query.
 *
 * The `notes` resource provider receives the request query as loosely typed
 * key/value pairs. Two forms are supported: an explicit `bbox` (a four-number
 * GeoJSON bounding box), and the `position` + `distance`
 * form chart plotters send, where `position` is the search center and
 * `distance` is the radius in meters. Returns null when the query does not
 * carry enough information to build a box.
 */
export function resolveBbox (query: Record<string, unknown>): Bbox | null {
  if (query.bbox !== undefined) {
    return resolveExplicitBbox(query.bbox)
  }

  const distance = parseFiniteNumber(query.distance)
  if (distance === null || distance <= 0) {
    return null
  }

  const center = resolvePosition(query.position)
  if (center === null) {
    return null
  }

  return positionToBbox(center, distance)
}
