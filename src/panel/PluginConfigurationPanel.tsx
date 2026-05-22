/**
 * Root component of the federated configuration panel. The Signal K admin UI
 * loads it from remoteEntry.js and renders it in place of the generated
 * react-jsonschema-form, passing the current configuration and a fire-and-forget
 * save callback.
 *
 * The panel is laid out in four zones: the status bar, the Data sources
 * accordion (one collapsible card per POI source), the Alerts section, and the
 * footer. The accordion keeps each source to a single collapsed row by
 * default, so adding sources does not clutter the panel.
 */

import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import AlertsSection from './components/AlertsSection.js'
import DataSourcesSection from './components/DataSourcesSection.js'
import FooterBar from './components/FooterBar.js'
import StatusBar from './components/StatusBar.js'
import { useConfig } from './hooks/use-config.js'
import { useStatus } from './hooks/use-status.js'
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

  const handleSave = useCallback((): void => {
    save(state)
    markSaved()
    setJustSavedAt(Date.now())
  }, [save, state, markSaved])

  const handleDiscard = useCallback((): void => {
    dispatch({ type: 'discard', config: savedState })
  }, [dispatch, savedState])

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
      <DataSourcesSection state={state} dispatch={dispatch} />
      <AlertsSection state={state} dispatch={dispatch} />
      <FooterBar
        dirty={dirty}
        justSavedAt={justSavedAt}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}
