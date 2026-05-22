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
 * Root component of the federated configuration panel. The Signal K admin UI
 * loads it from remoteEntry.js and renders it in place of the generated
 * react-jsonschema-form, passing the current configuration and a fire-and-forget
 * save callback.
 */

import type * as React from 'react'
import { useEffect, useState } from 'react'
import CacheDurationField from './components/CacheDurationField.js'
import FooterBar from './components/FooterBar.js'
import PoiTypeGroups from './components/PoiTypeGroups.js'
import StatusBar from './components/StatusBar.js'
import { useConfig } from './hooks/useConfig.js'
import { useStatus } from './hooks/useStatus.js'
import { S, THEME_STYLE } from './styles.js'

/** How long, in milliseconds, the "Saved" confirmation pill stays visible. */
const SAVED_PILL_MS = 2500

interface Props {
  /** The plugin configuration supplied by the admin UI. Untyped at the federation boundary. */
  configuration: unknown
  /** Persists the configuration. Fire-and-forget: it returns void and must not be awaited. */
  save: (configuration: unknown) => void
}

/** The configuration panel rendered inside the Signal K admin UI. */
export default function PluginConfigurationPanel ({ configuration, save }: Props): React.ReactElement {
  const { status, error } = useStatus()
  const { state, savedState, dispatch, markSaved } = useConfig(configuration)
  const [justSavedAt, setJustSavedAt] = useState<number | null>(null)

  // Clear the "Saved" pill a short while after a save.
  useEffect(() => {
    if (justSavedAt === null) return
    const timeoutId = setTimeout(() => setJustSavedAt(null), SAVED_PILL_MS)
    return () => clearTimeout(timeoutId)
  }, [justSavedAt])

  // Every reducer case returns a new object only on a real change, so identity
  // inequality against the last-saved snapshot is a sound dirty check.
  const dirty = state !== savedState

  const handleSave = (): void => {
    save(state)
    markSaved()
    setJustSavedAt(Date.now())
  }

  return (
    <div className='ac-config-panel' style={S.root}>
      <style>{THEME_STYLE}</style>
      <StatusBar status={status} />
      {error !== null
        ? (
          <div role='alert' style={S.errorBanner}>
            Status unavailable: {error}. The next poll will retry automatically.
          </div>
          )
        : null}
      <CacheDurationField
        value={state.cachingDurationMinutes}
        onChange={(minutes) => dispatch({ type: 'setCacheDuration', minutes })}
      />
      <PoiTypeGroups
        config={state}
        onToggle={(flag, enabled) => dispatch({ type: 'setPoiType', flag, enabled })}
        onSetAll={(enabled) => dispatch({ type: 'setAllPoiTypes', enabled })}
      />
      <FooterBar
        dirty={dirty}
        justSavedAt={justSavedAt}
        onSave={handleSave}
        onDiscard={() => dispatch({ type: 'discard', config: savedState })}
      />
    </div>
  )
}
