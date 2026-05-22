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
import { resolveBbox, resolvePosition } from '../src/resourceQuery.js'

test('resolvePosition reads a latitude/longitude object', () => {
  assert.deepEqual(
    resolvePosition({ latitude: 25.77, longitude: -80.18 }),
    { latitude: 25.77, longitude: -80.18 }
  )
})

test('resolvePosition reads a [longitude, latitude] array', () => {
  assert.deepEqual(
    resolvePosition([-80.18, 25.77]),
    { latitude: 25.77, longitude: -80.18 }
  )
})

test('resolvePosition returns null for unusable input', () => {
  assert.equal(resolvePosition(undefined), null)
  assert.equal(resolvePosition(null), null)
  assert.equal(resolvePosition('25.77,-80.18'), null)
  assert.equal(resolvePosition([42]), null)
  assert.equal(resolvePosition(['x', 'y']), null)
  assert.equal(resolvePosition({ latitude: 25.77 }), null)
})

test('resolveBbox derives a box from a position object and distance', () => {
  const bbox = resolveBbox({ position: { latitude: 25.77, longitude: -80.18 }, distance: 3000 })
  assert.ok(bbox !== null)
  assert.ok(bbox.north > bbox.south)
  assert.ok(bbox.east > bbox.west)
})

test('resolveBbox accepts the legacy array position form', () => {
  const bbox = resolveBbox({ position: [-80.18, 25.77], distance: 3000 })
  assert.ok(bbox !== null)
})

test('resolveBbox returns null when distance is missing, zero, or negative', () => {
  const position = { latitude: 25.77, longitude: -80.18 }
  assert.equal(resolveBbox({ position }), null)
  assert.equal(resolveBbox({ position, distance: 0 }), null)
  assert.equal(resolveBbox({ position, distance: -100 }), null)
  assert.equal(resolveBbox({ position, distance: 'far' }), null)
})

test('resolveBbox returns null when the position is missing or unusable', () => {
  assert.equal(resolveBbox({ distance: 3000 }), null)
  assert.equal(resolveBbox({ position: 'here', distance: 3000 }), null)
})

test('resolveBbox accepts an explicit bbox array', () => {
  // [minLongitude, minLatitude, maxLongitude, maxLatitude]
  const bbox = resolveBbox({ bbox: [-80.20, 25.70, -80.10, 25.85] })
  assert.deepEqual(bbox, { west: -80.20, south: 25.70, east: -80.10, north: 25.85 })
})

test('resolveBbox accepts an explicit bbox string, plain or bracketed', () => {
  const expected = { west: 5.4, south: 25.7, east: 6.9, north: 31.2 }
  assert.deepEqual(resolveBbox({ bbox: '5.4,25.7,6.9,31.2' }), expected)
  assert.deepEqual(resolveBbox({ bbox: '[5.4, 25.7, 6.9, 31.2]' }), expected)
})

test('resolveBbox returns null for a malformed bbox', () => {
  assert.equal(resolveBbox({ bbox: '1,2,3' }), null)
  assert.equal(resolveBbox({ bbox: [1, 2, 'x', 4] }), null)
  assert.equal(resolveBbox({ bbox: 42 }), null)
})
