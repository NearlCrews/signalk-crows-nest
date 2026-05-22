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
import { POI_TYPE_FLAGS, buildPoiTypesString } from '../src/poiTypeSelection.js'

test('buildPoiTypesString returns every type for a config with no flag keys', () => {
  const result = buildPoiTypesString({})
  assert.ok(result !== null)
  const types = result.split(',')
  assert.equal(types.length, POI_TYPE_FLAGS.length)
  assert.ok(types.includes('Marina'))
  assert.ok(types.includes('Airport'))
})

test('buildPoiTypesString returns null when every flag is explicitly false', () => {
  // All flag keys present and false is a deliberate "select none": the plugin
  // should import nothing, distinct from a pre-toggles config with no keys.
  const config = Object.fromEntries(POI_TYPE_FLAGS.map(([flag]) => [flag, false]))
  assert.equal(buildPoiTypesString(config), null)
})

test('buildPoiTypesString returns null when some flags are present and none is true', () => {
  assert.equal(buildPoiTypesString({ includeMarinas: false, includeHazards: false }), null)
})

test('buildPoiTypesString returns only the selected types', () => {
  const result = buildPoiTypesString({ includeMarinas: true, includeAnchorages: true })
  assert.equal(result, 'Marina,Anchorage')
})

test('buildPoiTypesString ignores flags that are not strictly true', () => {
  const result = buildPoiTypesString({
    includeMarinas: true,
    includeHazards: undefined,
    includeLocks: false
  })
  assert.equal(result, 'Marina')
})

test('buildPoiTypesString returns all selected types when every flag is true', () => {
  const config = Object.fromEntries(POI_TYPE_FLAGS.map(([flag]) => [flag, true]))
  const result = buildPoiTypesString(config)
  assert.ok(result !== null)
  assert.equal(result.split(',').length, POI_TYPE_FLAGS.length)
})
