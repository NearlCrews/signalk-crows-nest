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
 * React state hook for the panel's working configuration. It wraps the pure
 * configReducer in a useReducer, normalises the raw `configuration` prop the
 * admin UI hands in, and tracks the last-saved snapshot for the dirty check.
 */

import type { Dispatch } from 'react'
import { useReducer, useState } from 'react'
import type { PluginConfig } from '../../types.js'
import { configReducer } from '../configReducer.js'
import type { ConfigAction } from '../configReducer.js'
import { normaliseConfig } from '../normaliseConfig.js'

/** The configuration state surface the panel consumes. */
export interface UseConfigResult {
  /** The current working configuration, including any unsaved edits. */
  state: PluginConfig
  /** The configuration as of the last save (or the initial load). */
  savedState: PluginConfig
  /** Dispatches a ConfigAction through the reducer. */
  dispatch: Dispatch<ConfigAction>
  /** Records the current state as saved, clearing the dirty flag. */
  markSaved: () => void
}

/**
 * Manage the panel's configuration state. `configuration` is read once at
 * mount; later changes to the prop are ignored, because the panel itself is
 * the only writer and updates `savedState` directly through markSaved.
 */
export function useConfig (configuration: unknown): UseConfigResult {
  const [initial] = useState<PluginConfig>(() => normaliseConfig(configuration))
  const [state, dispatch] = useReducer(configReducer, initial)
  const [savedState, setSavedState] = useState<PluginConfig>(initial)

  const markSaved = (): void => {
    setSavedState(state)
  }

  return { state, savedState, dispatch, markSaved }
}
