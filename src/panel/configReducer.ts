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
 * Pure reducer over the plugin's PluginConfig shape, driving the configuration
 * panel's working state. It carries no React dependency, so it is exported and
 * unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../poiTypeSelection.js'
import type { PluginConfig, PoiTypeFlag } from '../types.js'

/** Actions the panel dispatches to mutate its working configuration. */
export type ConfigAction =
  | { type: 'setCacheDuration', minutes: number }
  | { type: 'setPoiType', flag: PoiTypeFlag, enabled: boolean }
  | { type: 'setAllPoiTypes', enabled: boolean }
  | { type: 'discard', config: PluginConfig }

/**
 * Apply an action to the configuration. Each case returns a new object only
 * when something actually changed and returns the input state otherwise, so
 * the panel can use identity equality against the last-saved snapshot as a
 * sound dirty check.
 */
export function configReducer (state: PluginConfig, action: ConfigAction): PluginConfig {
  switch (action.type) {
    case 'discard':
      return action.config
    case 'setCacheDuration':
      if (state.cachingDurationMinutes === action.minutes) return state
      return { ...state, cachingDurationMinutes: action.minutes }
    case 'setPoiType':
      if (state[action.flag] === action.enabled) return state
      return { ...state, [action.flag]: action.enabled }
    case 'setAllPoiTypes': {
      let changed = false
      const next: PluginConfig = { ...state }
      for (const [flag] of POI_TYPE_FLAGS) {
        if (next[flag] !== action.enabled) {
          next[flag] = action.enabled
          changed = true
        }
      }
      return changed ? next : state
    }
  }
}
