/**
 * React state hook for the panel's working configuration. It wraps the pure
 * configReducer in a useReducer, normalizes the raw `configuration` prop the
 * admin UI hands in, and tracks the last-saved snapshot for the dirty check.
 */

import type { Dispatch } from 'react'
import { useCallback, useReducer, useRef, useState } from 'react'
import type { PluginConfig } from '../../shared/types.js'
import { configReducer } from '../config-reducer.js'
import type { ConfigAction } from '../config-reducer.js'
import { normalizeConfig } from '../normalize-config.js'

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
  const [initial] = useState<PluginConfig>(() => normalizeConfig(configuration))
  const [state, dispatch] = useReducer(configReducer, initial)
  const [savedState, setSavedState] = useState<PluginConfig>(initial)

  // Keep markSaved's identity stable across renders by reading the latest
  // state through a ref, assigned during render (the same pattern the panel
  // root uses for handleSave) so the ref can never lag a committed state.
  // The previous `useCallback(_, [state])` recreated markSaved on every
  // keystroke, cascading through handleSave and re-rendering FooterBar even
  // when only an unrelated field changed.
  const stateRef = useRef(state)
  stateRef.current = state
  const markSaved = useCallback((): void => {
    setSavedState(stateRef.current)
  }, [])

  return { state, savedState, dispatch, markSaved }
}
