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
 * Parsing of the loosely typed SignalK resource-provider query into a search
 * bounding box.
 */

import { positionToBbox } from './positionUtilities.js'
import type { Bbox, Position } from './types.js'

/**
 * Normalise a query `position` value into a Position, or null if unusable.
 *
 * SignalK passes the search centre either as a `{ latitude, longitude }`
 * object or as a `[longitude, latitude]` array (the order the legacy plugin
 * relied on).
 */
export function resolvePosition (raw: unknown): Position | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const longitude = Number(raw[0])
    const latitude = Number(raw[1])
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return { latitude, longitude }
    }
    return null
  }

  if (raw !== null && typeof raw === 'object') {
    const candidate = raw as Record<string, unknown>
    const latitude = Number(candidate.latitude)
    const longitude = Number(candidate.longitude)
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude }
    }
  }

  return null
}

/**
 * Parse an explicit `bbox` query value into a Bbox.
 *
 * The SignalK resources API expresses a bounding box as four numbers in
 * `[minLongitude, minLatitude, maxLongitude, maxLatitude]` order, supplied
 * either as an array or as a comma-separated string (with or without
 * surrounding brackets). Returns null when the value is not four finite
 * numbers.
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
  const [west, south, east, north] = parts.map(Number)
  if (![west, south, east, north].every(value => Number.isFinite(value))) {
    return null
  }
  return { west, south, east, north }
}

/**
 * Derive a search bounding box from a SignalK resource query.
 *
 * The `notes` resource provider receives the request query as loosely typed
 * key/value pairs. Two forms are supported: an explicit `bbox` (the four-number
 * bounding box of the SignalK resources API), and the `position` + `distance`
 * form chart plotters send, where `position` is the search centre and
 * `distance` is the radius in metres. Returns null when the query does not
 * carry enough information to build a box.
 */
export function resolveBbox (query: Record<string, unknown>): Bbox | null {
  if (query.bbox !== undefined) {
    return resolveExplicitBbox(query.bbox)
  }

  const distance = Number(query.distance)
  if (!Number.isFinite(distance) || distance <= 0) {
    return null
  }

  const centre = resolvePosition(query.position)
  if (centre === null) {
    return null
  }

  return positionToBbox(centre, distance)
}
