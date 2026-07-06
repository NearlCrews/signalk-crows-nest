/**
 * The Data sources zone of the configuration panel: the per-source accordion.
 * It renders one collapsible `DataSourceCard` per POI source, each with the
 * matching card-body component as its children, plus a one-line summary built
 * from the current configuration so a collapsed card still says what it does.
 *
 * Disclosure state (which card is expanded) lives on the panel root and is
 * passed down here so the section is purely declarative. The card id is the
 * source's own PoiSource.id constant (imported from the source module), so a
 * future rename of one of the source ids is a single-site TypeScript
 * compile error rather than a silent panel/registry skew.
 */

import type * as React from 'react'
import { memo, useMemo, type Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { POI_TYPE_FLAGS } from '../../shared/poi-type-selection.js'
import { SEAMARK_GROUP_REFS } from '../../shared/seamark-groups.js'
import {
  ACTIVE_CAPTAIN_SOURCE_ID,
  NOAA_COOPS_SOURCE_ID,
  NOAA_ENC_SOURCE_ID,
  OPENSEAMAP_SOURCE_ID,
  USACE_SOURCE_ID,
  USCG_LIGHT_LIST_SOURCE_ID,
  USCG_LNM_SOURCE_ID,
  WPI_SOURCE_ID,
  type SourceSlug
} from '../../shared/source-ids.js'
import { DEFAULT_REFRESH_HOURS } from '../../shared/refresh-hours.js'
import { SECONDS_PER_MINUTE } from '../../shared/time.js'
import {
  DEFAULT_USACE_DEBOUNCE_SECONDS,
  DEFAULT_USCG_LNM_DEBOUNCE_SECONDS
} from '../../shared/bbox-debounce-bounds.js'
import { resolveScaleBand, SCALE_BAND_LABELS } from '../../shared/scale-band.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import type { SourceStatus, StatusSnapshot } from '../../status/status-types.js'
import ActiveCaptainSource from './ActiveCaptainSource.js'
import DataSourceCard from './DataSourceCard.js'
import NoaaCoopsSource from './NoaaCoopsSource.js'
import NoaaEncSource from './NoaaEncSource.js'
import OpenSeaMapSource from './OpenSeaMapSource.js'
import SectionBox from './SectionBox.js'
import UsaceSource from './UsaceSource.js'
import UscgLightListSource from './UscgLightListSource.js'
import UscgLnmSource from './UscgLnmSource.js'
import WpiSource from './WpiSource.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
  /** Per-source status snapshot, or null until the first poll resolves. */
  status: StatusSnapshot | null
  /** Which card slugs are currently expanded. */
  expanded: Partial<Record<SourceSlug, boolean>>
  /** Toggle the expansion of one card by its slug. */
  onToggleExpanded: (cardId: SourceSlug) => void
}

/** Build the ActiveCaptain card's collapsed one-line summary. */
function activeCaptainSummary (state: PluginConfig): string {
  const total = POI_TYPE_FLAGS.length
  const selected = POI_TYPE_FLAGS.filter(([flag]) => state[flag] === true).length
  // No selection means the plugin imports every type, so report it as such.
  const types = selected === 0 ? 'all POI types' : `${selected} of ${total} POI types`
  return `${types}, ${state.cachingDurationMinutes} min cache`
}

/**
 * Append a "since YYYY" tail to a card summary when the user has set the
 * per-source minimum-year filter to a non-zero value. Keeps the collapsed
 * row short when the filter is off (the common case).
 */
function appendSinceYear (summary: string, year: number | undefined): string {
  return year !== undefined && year > 0 ? `${summary}, since ${year}` : summary
}

/** Build the OpenSeaMap card's collapsed one-line summary. */
function openSeaMapSummary (state: PluginConfig): string {
  const selected = (state.openSeaMapSeamarkGroups ?? []).length
  return appendSinceYear(
    `${selected} of ${SEAMARK_GROUP_REFS.length} feature groups`,
    state.openSeaMapMinimumYear
  )
}

/** Build the USCG Light List card's collapsed one-line summary. */
function uscgLightListSummary (state: PluginConfig): string {
  const hours = state.uscgLightListRefreshHours ?? DEFAULT_REFRESH_HOURS
  return appendSinceYear(`${hours} h refresh`, state.uscgLightListMinimumUpdateYear)
}

/** Build the NOAA CO-OPS card's collapsed one-line summary. */
function noaaCoopsSummary (state: PluginConfig): string {
  const families: string[] = []
  if (state.noaaCoopsIncludeTideStations !== false) families.push('tide')
  if (state.noaaCoopsIncludeCurrentStations !== false) families.push('current')
  const stations = families.length === 0 ? 'no stations' : `${families.join(' and ')} stations`
  return `${stations}, ${state.noaaCoopsRefreshHours ?? DEFAULT_REFRESH_HOURS} h refresh`
}

/** Format a refresh window in seconds as minutes when it divides evenly. */
function refreshSecondsLabel (seconds: number): string {
  return seconds % SECONDS_PER_MINUTE === 0
    ? `${seconds / SECONDS_PER_MINUTE} min`
    : `${seconds} s`
}

/** Build the USCG Local Notice to Mariners card's collapsed one-line summary. */
function uscgLnmSummary (state: PluginConfig): string {
  const seconds = state.uscgLnmRefreshSeconds ?? DEFAULT_USCG_LNM_DEBOUNCE_SECONDS
  return `hazards, discrepancies, and notices, ${refreshSecondsLabel(seconds)} refresh`
}

/** Build the World Port Index card's collapsed one-line summary. */
function wpiSummary (state: PluginConfig): string {
  return `worldwide ports, ${state.wpiRefreshHours ?? DEFAULT_REFRESH_HOURS} h refresh`
}

/** Build the USACE card's collapsed one-line summary. */
function usaceSummary (state: PluginConfig): string {
  // Locks default on; dams default off (National Inventory of Dams volume).
  const layers: string[] = []
  if (state.usaceIncludeLocks !== false) layers.push('locks')
  if (state.usaceIncludeDams === true) layers.push('dams')
  const layerList = layers.length === 0 ? 'no layers' : layers.join(' and ')
  const seconds = state.usaceRefreshSeconds ?? DEFAULT_USACE_DEBOUNCE_SECONDS
  return `${layerList}, ${refreshSecondsLabel(seconds)} refresh`
}

/** Build the NOAA ENC card's collapsed one-line summary. */
function noaaEncSummary (state: PluginConfig): string {
  // Use the same friendly label the expanded card shows ("Harbor" not
  // "harbour", "Coastal" not "coastal"), so collapsing the card never
  // surfaces the raw NOAA wire value. resolveScaleBand maps an unknown
  // stored value to the default, the same coercion normalize-config applies.
  const label = SCALE_BAND_LABELS[resolveScaleBand(state.noaaEncScaleBand)]
  // Wrecks and obstructions default on; rocks default off.
  const layers: string[] = []
  if (state.noaaEncIncludeWrecks !== false) layers.push('wrecks')
  if (state.noaaEncIncludeObstructions !== false) layers.push('obstructions')
  if (state.noaaEncIncludeRocks === true) layers.push('rocks')
  const layerList = layers.length === 0 ? 'no layers' : layers.join(', ')
  return appendSinceYear(`${label} band, ${layerList}`, state.noaaEncMinimumSurveyYear)
}

/**
 * Index the per-source status entries by slug. Built once per status
 * snapshot via useMemo so the per-card lookup is O(1) and so a card's
 * `status` prop keeps referential equality across renders when the
 * snapshot itself does not change.
 */
function useStatusBySource (
  snapshot: StatusSnapshot | null
): ReadonlyMap<string, SourceStatus> {
  return useMemo(() => {
    const map = new Map<string, SourceStatus>()
    if (snapshot !== null) {
      for (const entry of snapshot.sources) map.set(entry.source, entry)
    }
    return map
  }, [snapshot])
}

/**
 * The per-source accordion shown in the configuration panel. Memoized so the
 * 5 s status-poll tick (which re-renders the panel root for the freshness
 * note) does not cascade into the four cards: every prop here keeps its
 * identity across a tick.
 */
export default memo(function DataSourcesSection (
  { state, dispatch, status, expanded, onToggleExpanded }: Props
): React.ReactElement {
  const statusBySource = useStatusBySource(status)
  // Off-by-default sources the getting-started callout points at: shown only
  // while none of them is enabled, so an established install never sees it.
  const noOptionalSourceEnabled =
    state.openSeaMapEnabled !== true &&
    state.uscgLightListEnabled !== true &&
    state.noaaEncEnabled !== true &&
    state.noaaCoopsEnabled !== true &&
    state.uscgLnmEnabled !== true &&
    state.wpiEnabled !== true &&
    state.usaceEnabled !== true
  return (
    <SectionBox cardId='data-sources' title='Data sources' defaultExpanded>
      {noOptionalSourceEnabled
        ? (
          <p style={S.infoCallout}>
            Getting started: Garmin ActiveCaptain is always on. The other
            sources below are off by default; expand a card and toggle one on
            to layer OpenSeaMap, US government, or worldwide port data onto
            the chart.
          </p>
          )
        : null}
      <DataSourceCard
        cardId={ACTIVE_CAPTAIN_SOURCE_ID}
        name='Garmin ActiveCaptain'
        enabled
        summary={activeCaptainSummary(state)}
        expanded={expanded[ACTIVE_CAPTAIN_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        status={statusBySource.get(ACTIVE_CAPTAIN_SOURCE_ID)}
      >
        <ActiveCaptainSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={OPENSEAMAP_SOURCE_ID}
        name='OpenSeaMap'
        enabled={state.openSeaMapEnabled === true}
        summary={openSeaMapSummary(state)}
        expanded={expanded[OPENSEAMAP_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setOpenSeaMapEnabled', enabled })}
        status={statusBySource.get(OPENSEAMAP_SOURCE_ID)}
      >
        <OpenSeaMapSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={USCG_LIGHT_LIST_SOURCE_ID}
        name='USCG Light List (US Aids to Navigation)'
        enabled={state.uscgLightListEnabled === true}
        summary={uscgLightListSummary(state)}
        expanded={expanded[USCG_LIGHT_LIST_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setUscgLightListEnabled', enabled })}
        status={statusBySource.get(USCG_LIGHT_LIST_SOURCE_ID)}
      >
        <UscgLightListSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={NOAA_ENC_SOURCE_ID}
        name='NOAA ENC Direct (US wrecks, obstructions, and rocks)'
        enabled={state.noaaEncEnabled === true}
        summary={noaaEncSummary(state)}
        expanded={expanded[NOAA_ENC_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setNoaaEncEnabled', enabled })}
        status={statusBySource.get(NOAA_ENC_SOURCE_ID)}
      >
        <NoaaEncSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={NOAA_COOPS_SOURCE_ID}
        name='NOAA CO-OPS (US tide and current stations)'
        enabled={state.noaaCoopsEnabled === true}
        summary={noaaCoopsSummary(state)}
        expanded={expanded[NOAA_COOPS_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setNoaaCoopsEnabled', enabled })}
        status={statusBySource.get(NOAA_COOPS_SOURCE_ID)}
      >
        <NoaaCoopsSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={USCG_LNM_SOURCE_ID}
        name='USCG Local Notice to Mariners (US live safety notices)'
        enabled={state.uscgLnmEnabled === true}
        summary={uscgLnmSummary(state)}
        expanded={expanded[USCG_LNM_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setUscgLnmEnabled', enabled })}
        status={statusBySource.get(USCG_LNM_SOURCE_ID)}
      >
        <UscgLnmSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={WPI_SOURCE_ID}
        name='NGA World Port Index (worldwide ports)'
        enabled={state.wpiEnabled === true}
        summary={wpiSummary(state)}
        expanded={expanded[WPI_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setWpiEnabled', enabled })}
        status={statusBySource.get(WPI_SOURCE_ID)}
      >
        <WpiSource state={state} dispatch={dispatch} />
      </DataSourceCard>
      <DataSourceCard
        cardId={USACE_SOURCE_ID}
        name='USACE locks and dams (US waterways)'
        enabled={state.usaceEnabled === true}
        summary={usaceSummary(state)}
        expanded={expanded[USACE_SOURCE_ID] === true}
        onToggleExpanded={onToggleExpanded}
        onToggleEnabled={(enabled) => dispatch({ type: 'setUsaceEnabled', enabled })}
        status={statusBySource.get(USACE_SOURCE_ID)}
      >
        <UsaceSource state={state} dispatch={dispatch} />
      </DataSourceCard>
    </SectionBox>
  )
})
