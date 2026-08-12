/**
 * React state hook for the panel's working configuration. It wraps the pure
 * configReducer in a useReducer, normalizes the raw `configuration` prop the
 * admin UI hands in, and tracks the last requested snapshot for the dirty check.
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
  /** The configuration as of the last save request (or the initial load). */
  requestedState: PluginConfig
  /** Dispatches a ConfigAction through the reducer. */
  dispatch: Dispatch<ConfigAction>
  /** Records the current state as requested, clearing the dirty flag. */
  markSaveRequested: () => void
  /**
   * True until the host has supplied a configuration or this session has
   * issued a save request. The admin UI passes a null or undefined configuration
   * for a never-configured plugin and does not re-send the prop after the panel's
   * fire-and-forget save, so the first markSaveRequested clears this here.
   */
  unconfigured: boolean
}

/**
 * Manage the panel's configuration state. `configuration` is read once at
 * mount; later changes to the prop are ignored, because the panel itself is
 * the only writer and updates `requestedState` directly through
 * markSaveRequested.
 */
export function useConfig (configuration: unknown): UseConfigResult {
  const [initial] = useState<PluginConfig>(() => normalizeConfig(configuration))
  const [state, dispatch] = useReducer(configReducer, initial)
  const [requestedState, setRequestedState] = useState<PluginConfig>(initial)
  const [unconfigured, setUnconfigured] = useState(() => configuration == null)

  // Keep markSaveRequested's identity stable across renders by reading the latest
  // state through a ref, assigned during render (the same pattern the panel
  // root uses for handleSave) so the ref can never lag a committed state.
  // The previous `useCallback(_, [state])` recreated this callback on every
  // keystroke, cascading through handleSave and re-rendering FooterBar even
  // when only an unrelated field changed.
  const stateRef = useRef(state)
  stateRef.current = state
  const markSaveRequested = useCallback((): void => {
    setRequestedState(stateRef.current)
    // The first request configures the plugin optimistically; the host's
    // callback is intentionally void and cannot report completion here.
    setUnconfigured(false)
  }, [])

  return { state, requestedState, dispatch, markSaveRequested, unconfigured }
}
