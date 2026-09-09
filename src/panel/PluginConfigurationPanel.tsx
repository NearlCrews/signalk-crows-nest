/**
 * Root component of the federated configuration panel. The Signal K admin UI
 * loads it from remoteEntry.js and renders it in place of the generated
 * react-jsonschema-form, passing the current configuration and a fire-and-forget
 * save callback.
 *
 * The panel is laid out in four zones: the status section, the Data sources
 * accordion (one collapsible card per POI source), the Alerts section, and the
 * save bar. The accordion keeps each source to a single collapsed row by
 * default, so adding sources does not clutter the panel.
 */

import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Banner, LiveRegion, PanelShell, useUnsavedChangesGuard } from 'signalk-nearlcrews-ui'
import { SaveActionBar } from 'signalk-nearlcrews-ui/composites'
import AlertsSection from './components/AlertsSection.js'
import DataSourcesSection from './components/DataSourcesSection.js'
import { revealSourceCard } from './components/DataSourceCard.js'
import StatusBar from './components/StatusBar.js'
import { DraftResetContext } from './hooks/draft-reset-context.js'
import { useConfig } from './hooks/use-config.js'
import { useStatus } from './hooks/use-status.js'
import { UnitSystemContext, useUnitSystem } from './hooks/use-unit-system.js'
import { SOURCE_SLUGS, type SourceSlug } from '../shared/source-ids.js'

/** How long, in milliseconds, the save-request confirmation stays visible. */
const SAVE_REQUEST_NOTICE_MS = 2500

/** The card slugs the jump-to-error shortcut may expand; anything else is ignored. */
const KNOWN_SLUGS: ReadonlySet<string> = new Set(SOURCE_SLUGS)

/** The poll-failure banner's title, shared with the announcement so the two cannot drift. */
const STATUS_UNAVAILABLE_TITLE = 'Status unavailable'

/** The note saying the panel recovers on its own, shared with the announcement. */
const STATUS_RETRY_NOTE = 'The next poll will retry automatically.'

/**
 * Stable DOM id of the panel's status announcer, following the source cards'
 * naming. The region has to exist before any message reaches it, so it is
 * addressable independently of whatever text it currently holds.
 */
const STATUS_ANNOUNCEMENT_DOM_ID = 'ac-status-announcement'

interface Props {
  /** The plugin configuration supplied by the admin UI. Untyped at the federation boundary. */
  configuration: unknown
  /** Requests a configuration save. Fire-and-forget: it returns void and must not be awaited. */
  save: (configuration: unknown) => void
}

/** The error boundary's secondary recovery: a full page reload. */
function reloadPage (): void {
  window.location.reload()
}

/**
 * The configuration panel rendered inside the Signal K admin UI. The shared
 * shell runs the native CSS scope preflight, installs the theme root, places
 * the theme toggle, and wraps the panel in an error boundary whose first
 * recovery remounts the panel subtree; only its second action reloads the
 * page, so a render error does not cost the operator the rest of the Admin
 * state by default.
 */
export default function PluginConfigurationPanel (props: Props): React.ReactElement {
  return (
    <PanelShell themeToggle='between' onReload={reloadPage}>
      <SupportedPluginConfigurationPanel {...props} />
    </PanelShell>
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
  // without each card needing its own useState. The card bodies stay
  // mounted while collapsed (the shared CollapsibleSection retains them)
  // so a half-typed numeric draft survives a collapse.
  const [expandedCards, setExpandedCards] =
    useState<Partial<Record<SourceSlug, boolean>>>({})
  const setCardExpanded = useCallback((cardId: SourceSlug, open: boolean): void => {
    setExpandedCards((prev) => ({ ...prev, [cardId]: open }))
  }, [])
  // The Data sources section's own disclosure state. It is controlled from
  // here, rather than left to the section's defaultOpen, because the
  // jump-to-error shortcut has to be able to open it: a collapsed
  // CollapsibleSection hides its retained children with the `hidden`
  // attribute, so a card inside a closed section can be neither displayed,
  // scrolled to, nor focused.
  const [dataSourcesOpen, setDataSourcesOpen] = useState(true)

  // Jump-to-error shortcut: reveal the offending source's card and hand focus
  // to it. The KNOWN_SLUGS guard makes the SourceSlug cast safe against a
  // status error recorded under an unexpected slug.
  const jumpToSource = useCallback((slug: string): void => {
    if (!KNOWN_SLUGS.has(slug)) return
    const cardId = slug as SourceSlug
    // Open the section first, or the card stays hidden inside it.
    setDataSourcesOpen(true)
    setExpandedCards((prev) => ({ ...prev, [cardId]: true }))
    // Reveal after both expansions have been committed and laid out.
    requestAnimationFrame(() => revealSourceCard(cardId))
  }, [])

  // Clear the save-request confirmation a short while after a request.
  useEffect(() => {
    if (saveRequestedAt === null) return
    const timeoutId = setTimeout(() => setSaveRequestedAt(null), SAVE_REQUEST_NOTICE_MS)
    return () => clearTimeout(timeoutId)
  }, [saveRequestedAt])

  // Every reducer case returns a new object only on a real change, so identity
  // inequality against the last requested snapshot is a sound dirty check.
  const dirty = state !== requestedState

  // Warn before a tab close or reload while edits are unsaved, so a
  // fat-fingered close cannot silently lose in-progress configuration.
  useUnsavedChangesGuard(dirty)

  // handleSave reads the latest state through a ref so its identity does not
  // change per keystroke.
  const stateRef = useRef(state)
  stateRef.current = state
  const handleSave = useCallback((): void => {
    save(stateRef.current)
    markSaveRequested()
    setSaveRequestedAt(Date.now())
  }, [save, markSaveRequested])

  // Bumped on every Discard so each numeric field drops its raw-text draft
  // even when the restored value is identical to the committed one (see
  // draft-reset-context.ts for why the value-change rule misses that).
  const [discardEpoch, setDiscardEpoch] = useState(0)
  const handleDiscard = useCallback((): void => {
    dispatch({ type: 'discard', config: requestedState })
    setDiscardEpoch((epoch) => epoch + 1)
  }, [dispatch, requestedState])

  return (
    <UnitSystemContext.Provider value={unitSystem}>
      <DraftResetContext.Provider value={discardEpoch}>
        <StatusBar status={status} lastUpdatedMs={lastUpdatedMs} onJumpToSource={jumpToSource} />
        {/*
          The announcer is mounted before any message reaches it, because a
          live region created together with its text is not announced
          reliably. The banner below carries the same words visibly without
          being a second live region, so the failure is spoken once.
        */}
        <LiveRegion
          id={STATUS_ANNOUNCEMENT_DOM_ID}
          message={error === null
            ? ''
            : `${STATUS_UNAVAILABLE_TITLE}. ${error}. ${STATUS_RETRY_NOTE}`}
        />
        {error !== null
          ? (
            <Banner tone='danger' title={STATUS_UNAVAILABLE_TITLE}>
              {error}. {STATUS_RETRY_NOTE}
            </Banner>
            )
          : null}
        <DataSourcesSection
          state={state}
          dispatch={dispatch}
          status={status}
          expanded={expandedCards}
          onToggleExpanded={setCardExpanded}
          open={dataSourcesOpen}
          onOpenChange={setDataSourcesOpen}
        />
        <AlertsSection state={state} dispatch={dispatch} />
        <SaveActionBar
          dirty={dirty}
          unconfigured={unconfigured}
          saveRequestedAt={saveRequestedAt}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      </DraftResetContext.Provider>
    </UnitSystemContext.Provider>
  )
}
