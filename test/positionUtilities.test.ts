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

import test from 'node:test'
import assert from 'node:assert/strict'
import { positionToBbox } from '../src/positionUtilities.js'
import type { Position } from '../src/types.js'

/** Assert that two numbers are within `epsilon` of each other. */
function assertClose (actual: number, expected: number, epsilon: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${actual} to be within ${epsilon} of ${expected}`
  )
}

test('positionToBbox encloses the search radius on every cardinal edge', () => {
  // Centre on the origin so the great-circle projection is symmetric. The box
  // must enclose the search circle, so each cardinal edge sits at the full
  // search radius from the centre. For a 10 km radius that is about 0.0899317
  // degrees (10 km / 6371 km, converted to degrees), not the smaller value an
  // inscribed box would give.
  const bbox = positionToBbox({ latitude: 0, longitude: 0 }, 10000)

  assertClose(bbox.north, 0.0899317, 1e-4, 'north edge')
  assertClose(bbox.south, -0.0899317, 1e-4, 'south edge')
  assertClose(bbox.east, 0.0899317, 1e-4, 'east edge')
  assertClose(bbox.west, -0.0899317, 1e-4, 'west edge')
})

test('positionToBbox orders the edges around the centre', () => {
  const centre: Position = { latitude: 45, longitude: -122 }
  const bbox = positionToBbox(centre, 5000)

  assert.ok(bbox.north > centre.latitude, 'north edge is above the centre')
  assert.ok(bbox.south < centre.latitude, 'south edge is below the centre')
  assert.ok(bbox.east > centre.longitude, 'east edge is right of the centre')
  assert.ok(bbox.west < centre.longitude, 'west edge is left of the centre')
})

test('positionToBbox is symmetric about a position on the equator and prime meridian', () => {
  // At the origin the projection is exactly symmetric, so opposite edges
  // should mirror each other.
  const bbox = positionToBbox({ latitude: 0, longitude: 0 }, 25000)

  assertClose(bbox.north, -bbox.south, 1e-9, 'north and south mirror each other')
  assertClose(bbox.east, -bbox.west, 1e-9, 'east and west mirror each other')
})

test('positionToBbox handles a position on the equator', () => {
  const bbox = positionToBbox({ latitude: 0, longitude: -40 }, 8000)

  // The centre latitude is 0, so the box straddles the equator.
  assert.ok(bbox.north > 0, 'north edge crosses into the northern hemisphere')
  assert.ok(bbox.south < 0, 'south edge crosses into the southern hemisphere')
  assertClose(bbox.north, -bbox.south, 1e-9, 'box is symmetric across the equator')
  assertClose((bbox.east + bbox.west) / 2, -40, 1e-9, 'box stays centred on longitude -40')
})

test('positionToBbox handles a position on the prime meridian', () => {
  const bbox = positionToBbox({ latitude: 50, longitude: 0 }, 8000)

  // The centre longitude is 0, so the box straddles the prime meridian.
  assert.ok(bbox.east > 0, 'east edge crosses into positive longitude')
  assert.ok(bbox.west < 0, 'west edge crosses into negative longitude')
  // Longitude is only exactly symmetric on the equator: away from it the
  // great-circle projection skews the two corners slightly, so the east and
  // west edges should mirror each other only approximately.
  assertClose(bbox.east, -bbox.west, 1e-3, 'box is roughly symmetric across the prime meridian')
})

test('positionToBbox normalizes longitude near the antimeridian', () => {
  // Close to the 180 meridian the eastern corner projects past 180 degrees.
  // The result must wrap back into the canonical [-180, 180] range rather
  // than reporting something like 181.
  const bbox = positionToBbox({ latitude: 0, longitude: 179.95 }, 10000)

  for (const [edge, value] of [['east', bbox.east], ['west', bbox.west]] as const) {
    assert.ok(value >= -180 && value <= 180, `${edge} longitude ${value} is within [-180, 180]`)
  }

  // The eastern corner has crossed the antimeridian, so it wraps to a
  // negative longitude while the western corner stays just below 180.
  assert.ok(bbox.east < 0, 'east edge wrapped to a negative longitude')
  assert.ok(bbox.west > 179, 'west edge stayed just west of the antimeridian')
})

test('positionToBbox grows the box as the distance increases', () => {
  const centre: Position = { latitude: 10, longitude: 20 }
  const small = positionToBbox(centre, 1000)
  const large = positionToBbox(centre, 50000)

  assert.ok(large.north - large.south > small.north - small.south, 'taller box for a larger distance')
  assert.ok(large.east - large.west > small.east - small.west, 'wider box for a larger distance')
})

test('positionToBbox returns a zero-size box for a zero distance', () => {
  const centre: Position = { latitude: 12.34, longitude: -56.78 }
  const bbox = positionToBbox(centre, 0)

  assertClose(bbox.north, centre.latitude, 1e-9, 'north collapses onto the centre')
  assertClose(bbox.south, centre.latitude, 1e-9, 'south collapses onto the centre')
  assertClose(bbox.east, centre.longitude, 1e-9, 'east collapses onto the centre')
  assertClose(bbox.west, centre.longitude, 1e-9, 'west collapses onto the centre')
})
