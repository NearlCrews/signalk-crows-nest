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
  NOAA_ENC_SOURCE_ID,
  OPENSEAMAP_SOURCE_ID,
  USCG_LIGHT_LIST_SOURCE_ID,
  type SourceSlug
} from '../../shared/source-ids.js'
import { DEFAULT_REFRESH_HOURS } from '../../shared/refresh-hours.js'
import { resolveScaleBand, SCALE_BAND_LABELS } from '../../shared/scale-band.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import type { SourceStatus, StatusSnapshot } from '../../status/status-types.js'
import ActiveCaptainSource from './ActiveCaptainSource.js'
import DataSourceCard from './DataSourceCard.js'
import NoaaEncSource from './NoaaEncSource.js'
import OpenSeaMapSource from './OpenSeaMapSource.js'
import SectionBox from './SectionBox.js'
import UscgLightListSource from './UscgLightListSource.js'

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
    state.noaaEncEnabled !== true
  return (
    <SectionBox cardId='data-sources' title='Data sources' defaultExpanded>
      {noOptionalSourceEnabled
        ? (
          <p style={S.infoCallout}>
            Getting started: Garmin ActiveCaptain is always on. The other
            sources below are off by default; expand a card and toggle one on
            to layer OpenSeaMap, USCG Light List, or NOAA ENC Direct data onto
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
    </SectionBox>
  )
})
