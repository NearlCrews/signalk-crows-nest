/**
 * The OpenSeaMap data-source card body. Field order follows the same
 * convention every per-source card uses: the connection override (the
 * Overpass endpoint, then its optional fallback mirrors) sits above the four
 * buckets; then layers (seamark groups); then refresh period (per-bbox
 * debounce in seconds); then update year; then merge option (dedupe toggle
 * plus merge radius).
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_MINIMUM_YEAR } from '../../shared/year-filter.js'
import { DEFAULT_OVERPASS_ENDPOINT } from '../../shared/overpass-endpoints.js'
import { DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS } from '../../shared/bbox-debounce.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import EndpointUrlField from './EndpointUrlField.js'
import FallbackEndpointsField from './FallbackEndpointsField.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import MinimumYearField from './MinimumYearField.js'
import RefreshSecondsField from './RefreshSecondsField.js'
import SeamarkGroups from './SeamarkGroups.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the OpenSeaMap source. */
export default function OpenSeaMapSource ({ state, dispatch }: Props): React.ReactElement {
  const selected = state.openSeaMapSeamarkGroups ?? []
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.openSeaMapDedupe !== false

  return (
    <>
      <EndpointUrlField
        value={state.openSeaMapEndpoint ?? DEFAULT_OVERPASS_ENDPOINT}
        onChange={(endpoint) => dispatch({ type: 'setOpenSeaMapEndpoint', endpoint })}
      />
      <FallbackEndpointsField
        value={state.openSeaMapFallbackEndpoints ?? []}
        onChange={(endpoints) => dispatch({ type: 'setOpenSeaMapFallbackEndpoints', endpoints })}
      />
      <SeamarkGroups
        selected={selected}
        onToggle={(id, enabled) => dispatch({
          type: 'setOpenSeaMapSeamarkGroups',
          // Rebuild from the canonical group order so toggling a group off and
          // on again does not reshuffle the stored list.
          groups: SEAMARK_GROUP_IDS.filter(
            (groupId) => groupId === id ? enabled : selected.includes(groupId))
        })}
      />
      <fieldset style={S.group}>
        <legend style={S.groupTitle}>Refresh and freshness</legend>
        <RefreshSecondsField
          id='ac-openseamap-refresh-seconds'
          label='Refresh period (seconds)'
          upstreamHint={'OSM seamark edits trickle in slowly, and the Overpass ' +
            'mirrors are shared community infrastructure, so the 10 minute ' +
            'default is friendly to both; raise it freely.'}
          value={state.openSeaMapRefreshSeconds ?? DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS}
          onChange={(seconds) => dispatch({ type: 'setOpenSeaMapRefreshSeconds', seconds })}
        />
        <MinimumYearField
          id='ac-openseamap-minimum-year'
          label='Earliest update year'
          hint={'Hide OSM elements whose last-edit timestamp is older than ' +
            'this year. Leave at 0 to import every element. The timestamp is ' +
            'an OSM contributor freshness signal: an unedited element from ' +
            '2012 may still be correct, so old does not always mean stale. ' +
            'Elements with no recorded timestamp are always included.'}
          value={state.openSeaMapMinimumYear ?? DEFAULT_MINIMUM_YEAR}
          onChange={(year) => dispatch({ type: 'setOpenSeaMapMinimumYear', year })}
        />
      </fieldset>
      <MergeWithActiveCaptain
        sourceName='OpenSeaMap'
        enabled={dedupeEnabled}
        onToggleEnabled={(enabled) => dispatch({ type: 'setOpenSeaMapDedupe', enabled })}
        radiusMeters={state.openSeaMapDedupeRadiusMeters}
        onChangeRadius={(meters) => dispatch({ type: 'setOpenSeaMapDedupeRadius', meters })}
        radiusInputId='ac-openseamap-dedupe-radius'
      />
    </>
  )
}
