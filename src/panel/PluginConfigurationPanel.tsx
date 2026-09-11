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
import { useCallback, useRef, useState } from 'react'
import { Banner, PanelShell, useUnsavedChangesGuard } from 'signalk-nearlcrews-ui'
import { SaveActionBar } from 'signalk-nearlcrews-ui/composites'
import AlertsSection from './components/AlertsSection.js'
import DataSourcesSection from './components/DataSourcesSection.js'
import { revealSourceCard } from './components/DataSourceCard.js'
import StatusBar from './components/StatusBar.js'
import { endpointInvalidMessage } from './endpoint-validation.js'
import { isSourceSlug } from './source-names.js'
import { DraftResetContext } from './hooks/draft-reset-context.js'
import { useConfig } from './hooks/use-config.js'
import { useStatus, type StatusPollError } from './hooks/use-status.js'
import { UnitSystemContext, useUnitSystem } from './hooks/use-unit-system.js'
import { type SourceSlug } from '../shared/source-ids.js'

/**
 * What the status banner shows for a failed poll, or undefined while the
 * endpoint is answering and the banner renders empty.
 *
 * Only an authentication failure is unrecoverable, and no amount of retrying
 * signs the operator back in, so promising a retry there would be telling
 * them to wait for something that never comes.
 */
function statusBannerText (
  error: StatusPollError | null
): { title: string, body: string } | undefined {
  if (error === null) return undefined
  return {
    title: 'Status unavailable',
    body: `${error.message}. ${error.recoverable
      ? 'The next poll will retry automatically.'
      : 'Sign in to Signal K again to restore it.'}`
  }
}

/**
 * Stable DOM id of the panel's status banner, following the source cards'
 * naming. The banner announces, so it is mounted before it has anything to
 * say and has to be addressable independently of whatever text it holds.
 */
const STATUS_BANNER_DOM_ID = 'ac-status-banner'

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
 *
 * The theme selector trails the panel. It is chrome rather than the operator's
 * task, so it should not take the first tab stop ahead of the status readout
 * and the source cards. The Admin owns the heading above the panel, so the
 * shell carries no title of its own, which also leaves its sections at the
 * level the Admin's own card header expects.
 */
export default function PluginConfigurationPanel (props: Props): React.ReactElement {
  return (
    <PanelShell themeToggle='end' onReload={reloadPage}>
      <SupportedPluginConfigurationPanel {...props} />
    </PanelShell>
  )
}

function SupportedPluginConfigurationPanel ({ configuration, save }: Props): React.ReactElement {
  const { status, error, lastUpdatedMs } = useStatus()
  const bannerText = statusBannerText(error)
  const { state, requestedState, dispatch, markSaveRequested, unconfigured } = useConfig(configuration)
  // The display system the server's unit preferences select; the LengthFields
  // read it through context so the meters-backed config renders in feet when
  // the active preset is imperial.
  const unitSystem = useUnitSystem()
  // The save bar takes its own confirmation down a short while after this
  // timestamp, so the panel records the instant and nothing more.
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
  // to it. The guard narrows, so a status error recorded under an unexpected
  // slug is ignored rather than keying the card map with it.
  const jumpToSource = useCallback((slug: string): void => {
    if (!isSourceSlug(slug)) return
    // Open the section first, or the card stays hidden inside it.
    setDataSourcesOpen(true)
    setExpandedCards((prev) => ({ ...prev, [slug]: true }))
    // Reveal after both expansions have been committed and laid out.
    requestAnimationFrame(() => revealSourceCard(slug))
  }, [])

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
          One announcing banner rather than a hidden live region beside a
          conditional banner. It is mounted before the first failure, because
          a live region created together with its text is not announced
          reliably, and it shows and speaks the same words, so the failure is
          spoken once. With nothing to report it renders empty and takes up
          no space.

          Polite rather than assertive, despite the danger tone: nothing is
          lost, no action is required, and the next poll recovers on its own,
          so interrupting whatever the operator is reading, again on every
          changed status code, would cost more than it tells them.
        */}
        <Banner
          id={STATUS_BANNER_DOM_ID}
          tone='danger'
          live='polite'
          title={bannerText?.title}
        >
          {bannerText?.body}
        </Banner>
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
        {/*
          The save bar blocks on an unusable endpoint rather than letting the
          plugin swallow it: both endpoint fields are coerced on load, so a
          typo that reaches the save is replaced by the default and lost.
        */}
        <SaveActionBar
          dirty={dirty}
          unconfigured={unconfigured}
          invalidMessage={endpointInvalidMessage(state)}
          saveRequestedAt={saveRequestedAt}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      </DraftResetContext.Provider>
    </UnitSystemContext.Provider>
  )
}
