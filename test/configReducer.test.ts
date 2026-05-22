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
import { configReducer } from '../src/panel/configReducer.js'
import { POI_TYPE_FLAGS } from '../src/poiTypeSelection.js'
import type { PluginConfig } from '../src/types.js'

/** A minimal config with only the required cache duration set. */
function baseConfig (): PluginConfig {
  return { cachingDurationMinutes: 60 }
}

/** A config with every POI-type flag enabled. */
function allEnabledConfig (): PluginConfig {
  return {
    ...baseConfig(),
    ...Object.fromEntries(POI_TYPE_FLAGS.map(([flag]) => [flag, true]))
  }
}

test('setCacheDuration updates the cache duration', () => {
  const next = configReducer(baseConfig(), { type: 'setCacheDuration', minutes: 120 })
  assert.equal(next.cachingDurationMinutes, 120)
})

test('setCacheDuration returns the same state when the value is unchanged', () => {
  const state = baseConfig()
  const next = configReducer(state, { type: 'setCacheDuration', minutes: 60 })
  assert.equal(next, state)
})

test('setPoiType enables a single flag', () => {
  const next = configReducer(baseConfig(), { type: 'setPoiType', flag: 'includeMarinas', enabled: true })
  assert.equal(next.includeMarinas, true)
})

test('setPoiType disables a single flag', () => {
  const state: PluginConfig = { ...baseConfig(), includeHazards: true }
  const next = configReducer(state, { type: 'setPoiType', flag: 'includeHazards', enabled: false })
  assert.equal(next.includeHazards, false)
})

test('setPoiType leaves the other flags untouched', () => {
  const state: PluginConfig = { ...baseConfig(), includeAnchorages: true }
  const next = configReducer(state, { type: 'setPoiType', flag: 'includeMarinas', enabled: true })
  assert.equal(next.includeAnchorages, true)
  assert.equal(next.includeMarinas, true)
})

test('setPoiType returns the same state when the flag is unchanged', () => {
  const state: PluginConfig = { ...baseConfig(), includeMarinas: true }
  const next = configReducer(state, { type: 'setPoiType', flag: 'includeMarinas', enabled: true })
  assert.equal(next, state)
})

test('setAllPoiTypes enables every POI flag', () => {
  const next = configReducer(baseConfig(), { type: 'setAllPoiTypes', enabled: true })
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(next[flag], true, `${flag} should be enabled`)
  }
})

test('setAllPoiTypes disables every POI flag', () => {
  const next = configReducer(allEnabledConfig(), { type: 'setAllPoiTypes', enabled: false })
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(next[flag], false, `${flag} should be disabled`)
  }
})

test('setAllPoiTypes preserves the cache duration', () => {
  const next = configReducer(baseConfig(), { type: 'setAllPoiTypes', enabled: true })
  assert.equal(next.cachingDurationMinutes, 60)
})

test('setAllPoiTypes returns the same state when nothing changes', () => {
  const state = allEnabledConfig()
  const next = configReducer(state, { type: 'setAllPoiTypes', enabled: true })
  assert.equal(next, state)
})

test('discard returns the supplied configuration', () => {
  const edited: PluginConfig = { ...baseConfig(), cachingDurationMinutes: 999, includeMarinas: true }
  const saved: PluginConfig = { ...baseConfig(), includeAnchorages: true }
  const next = configReducer(edited, { type: 'discard', config: saved })
  assert.equal(next, saved)
})
