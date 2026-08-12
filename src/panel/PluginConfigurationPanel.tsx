/**
 * Root component of the federated configuration panel. The Signal K admin UI
 * loads it from remoteEntry.js and renders it in place of the generated
 * react-jsonschema-form, passing the current configuration and a fire-and-forget
 * save callback.
 *
 * The panel is laid out in four zones: the status bar, the Data sources
 * accordion (one collapsible card per POI source), the Alerts section, and the
 * footer. The accordion keeps each source to a single collapsed row by default,
 * so adding sources does not clutter the panel.
 */

import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Banner,
  Cluster,
  PanelRoot,
  Stack,
  supportsNativeCssScope,
  ThemeToggle,
  UnsupportedBrowserNotice
} from 'signalk-nearlcrews-ui'
import AlertsSection from './components/AlertsSection.js'
import DataSourcesSection from './components/DataSourcesSection.js'
import { sourceCardDomId } from './components/DataSourceCard.js'
import ErrorBoundary from './components/ErrorBoundary.js'
import FooterBar from './components/FooterBar.js'
import StatusBar from './components/StatusBar.js'
import { DraftResetContext } from './hooks/draft-reset-context.js'
import { useConfig } from './hooks/use-config.js'
import { useStatus } from './hooks/use-status.js'
import { UnitSystemContext, useUnitSystem } from './hooks/use-unit-system.js'
import { SOURCE_SLUGS, type SourceSlug } from '../shared/source-ids.js'
import { PANEL_STYLE } from './styles.js'

/** How long, in milliseconds, the save-request confirmation stays visible. */
const SAVE_REQUEST_PILL_MS = 2500

/** The card slugs the jump-to-error shortcut may expand; anything else is ignored. */
const KNOWN_SLUGS: ReadonlySet<string> = new Set(SOURCE_SLUGS)

interface Props {
  /** The plugin configuration supplied by the admin UI. Untyped at the federation boundary. */
  configuration: unknown
  /** Requests a configuration save. Fire-and-forget: it returns void and must not be awaited. */
  save: (configuration: unknown) => void
}

/** The configuration panel rendered inside the Signal K admin UI. */
export default function PluginConfigurationPanel (props: Props): React.ReactElement {
  if (typeof window === 'undefined' || !supportsNativeCssScope(window)) {
    return (
      <UnsupportedBrowserNotice>
        This panel requires native CSS @scope. Update the browser or embedded WebView before
        reopening Signal K Admin.
      </UnsupportedBrowserNotice>
    )
  }

  return (
    <PanelRoot className='ac-config-panel' style={PANEL_STYLE}>
      <ErrorBoundary>
        <SupportedPluginConfigurationPanel {...props} />
      </ErrorBoundary>
    </PanelRoot>
  )
}

function SupportedPluginConfigurationPanel ({ configuration, save }: Props): React.ReactElement {
  const { status, error, lastUpdatedMs } = useStatus()
  const { state, requestedState, dispatch, markSaveRequested, unconfigured } = useConfig(configuration)
  // The display system the server's unit preferences select; the LengthFields
  // read it through context so the meters-backed config renders in feet when
  // the active preset is imperial.
  const unitSystem = useUnitSystem()
  const [saveRequestedAt, setSaveRequestedAt] = useState<number | null>(null)
  // Per-source disclosure state lives at the panel root so it survives
  // saves, so the DataSourceCards can iterate it with a stable map,
  // and so it can later be persisted to the URL or to local storage
  // without each card needing its own useState. The card-body subtree
  // itself stays mounted (the card swaps `display: none` rather than
  // unmounting) so a half-typed NumberField draft survives a collapse.
  const [expandedCards, setExpandedCards] =
    useState<Partial<Record<SourceSlug, boolean>>>({})
  const toggleCard = useCallback((cardId: SourceSlug): void => {
    setExpandedCards((prev) => ({ ...prev, [cardId]: !(prev[cardId] === true) }))
  }, [])

  // Jump-to-error shortcut: expand the offending source's card and scroll it
  // into view. The KNOWN_SLUGS guard makes the SourceSlug cast safe against a
  // status error recorded under an unexpected slug.
  const jumpToSource = useCallback((slug: string): void => {
    if (!KNOWN_SLUGS.has(slug)) return
    setExpandedCards((prev) => ({ ...prev, [slug as SourceSlug]: true }))
    // Scroll after the expansion has been committed and laid out.
    requestAnimationFrame(() => {
      document.getElementById(sourceCardDomId(slug))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  // Clear the save-request confirmation a short while after a request.
  useEffect(() => {
    if (saveRequestedAt === null) return
    const timeoutId = setTimeout(() => setSaveRequestedAt(null), SAVE_REQUEST_PILL_MS)
    return () => clearTimeout(timeoutId)
  }, [saveRequestedAt])

  // Every reducer case returns a new object only on a real change, so identity
  // inequality against the last requested snapshot is a sound dirty check.
  const dirty = state !== requestedState

  // Warn before a tab close or reload while edits are unsaved, so a
  // fat-fingered close cannot silently lose in-progress configuration.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      // Chrome ignores preventDefault alone; setting returnValue is what
      // actually triggers its leave-confirmation dialog.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // handleSave reads the latest state through a ref so its identity does not
  // change per keystroke; that keeps the memoized FooterBar from re-rendering
  // until the dirty flag actually flips.
  const stateRef = useRef(state)
  stateRef.current = state
  const handleSave = useCallback((): void => {
    save(stateRef.current)
    markSaveRequested()
    setSaveRequestedAt(Date.now())
  }, [save, markSaveRequested])

  // Bumped on every Discard so each useNumberDraft drops its raw-text draft
  // even when the restored value is identical to the committed one (see
  // draft-reset-context.ts for why the value-change detector misses that).
  const [discardEpoch, setDiscardEpoch] = useState(0)
  const handleDiscard = useCallback((): void => {
    dispatch({ type: 'discard', config: requestedState })
    setDiscardEpoch((epoch) => epoch + 1)
  }, [dispatch, requestedState])

  return (
    <UnitSystemContext.Provider value={unitSystem}>
      <DraftResetContext.Provider value={discardEpoch}>
        <Stack gap={4}>
          <Cluster justify='end'>
            <ThemeToggle />
          </Cluster>
          <StatusBar status={status} lastUpdatedMs={lastUpdatedMs} onJumpToSource={jumpToSource} />
          {error !== null
            ? (
              <Banner live='polite' tone='danger' title='Status unavailable'>
                {error}. The next poll will retry automatically.
              </Banner>
              )
            : null}
          <DataSourcesSection
            state={state}
            dispatch={dispatch}
            status={status}
            expanded={expandedCards}
            onToggleExpanded={toggleCard}
          />
          <AlertsSection state={state} dispatch={dispatch} />
          <FooterBar
            dirty={dirty}
            unconfigured={unconfigured}
            saveRequestedAt={saveRequestedAt}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        </Stack>
      </DraftResetContext.Provider>
    </UnitSystemContext.Provider>
  )
}
