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

import { DEFAULT_CACHE_DURATION_MINUTES, normaliseConfig } from '../src/panel/normaliseConfig.js'
import { POI_TYPE_FLAGS } from '../src/poiTypeSelection.js'

test('normaliseConfig fills every POI flag true and the default duration for an empty config', () => {
  const config = normaliseConfig({})
  assert.equal(config.cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(config[flag], true, `${flag} defaults to true`)
  }
})

test('normaliseConfig keeps a valid cache duration', () => {
  assert.equal(normaliseConfig({ cachingDurationMinutes: 15 }).cachingDurationMinutes, 15)
})

test('normaliseConfig falls back to the default for an unusable cache duration', () => {
  assert.equal(normaliseConfig({ cachingDurationMinutes: 0 }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  assert.equal(normaliseConfig({ cachingDurationMinutes: -5 }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  assert.equal(normaliseConfig({ cachingDurationMinutes: 'soon' }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
})

test('normaliseConfig preserves an explicitly disabled POI flag', () => {
  const config = normaliseConfig({ includeMarinas: false, includeHazards: true })
  assert.equal(config.includeMarinas, false)
  assert.equal(config.includeHazards, true)
  assert.equal(config.includeAnchorages, true, 'an absent flag still defaults to true')
})

test('normaliseConfig treats a non-object configuration as empty', () => {
  for (const input of [null, undefined, 'config', 42]) {
    const config = normaliseConfig(input)
    assert.equal(config.cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
    assert.equal(config.includeMarinas, true)
  }
})
