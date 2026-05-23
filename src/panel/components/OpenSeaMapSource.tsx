/**
 * The OpenSeaMap data-source card body. Field order follows the same
 * convention every per-source card uses: the connection override (the
 * Overpass endpoint) sits above the four buckets; then layers (seamark
 * groups); then refresh period (per-bbox debounce in seconds); then update
 * year; then merge option (dedupe toggle plus merge radius).
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_MINIMUM_YEAR,
  DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS,
  DEFAULT_OPENSEAMAP_ENDPOINT,
  DEFAULT_REFRESH_SECONDS
} from '../normalize-config.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import EndpointUrlField from './EndpointUrlField.js'
import MinimumYearField from './MinimumYearField.js'
import NumberField from './NumberField.js'
import RefreshSecondsField from './RefreshSecondsField.js'
import SeamarkGroups from './SeamarkGroups.js'

/**
 * Smallest dedupe radius the plugin accepts. A zero radius would leave
 * dedupe enabled but unable to ever match, so the field floors at one meter,
 * matching the `openSeaMapDedupeRadiusMeters` schema minimum.
 */
const MIN_DEDUPE_RADIUS_METERS = 1

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
        value={state.openSeaMapEndpoint ?? DEFAULT_OPENSEAMAP_ENDPOINT}
        onChange={(endpoint) => dispatch({ type: 'setOpenSeaMapEndpoint', endpoint })}
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
      <RefreshSecondsField
        id='ac-openseamap-refresh-seconds'
        label='Refresh period (seconds)'
        hint={'How long to reuse the most recent Overpass result for the ' +
          'same chart viewport before re-querying. A Freeboard refresh ' +
          'burst on a stationary view stays inside the cache; a user who ' +
          'pans to a fresh view re-queries immediately. Leave at 0 to ' +
          'query Overpass on every list call.'}
        value={state.openSeaMapRefreshSeconds ?? DEFAULT_REFRESH_SECONDS}
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
      <label style={S.checkboxRow}>
        <input
          type='checkbox'
          style={S.checkbox}
          checked={dedupeEnabled}
          onChange={(e) => dispatch({ type: 'setOpenSeaMapDedupe', enabled: e.target.checked })}
        />
        Merge OpenSeaMap markers that duplicate an ActiveCaptain marker
      </label>
      <p style={S.hint}>
        When enabled, an OpenSeaMap point of interest close to an ActiveCaptain
        point of the same type is merged into it, so one physical feature is
        shown once. The surviving marker records every source that reported it.
      </p>
      <NumberField
        id='ac-openseamap-dedupe-radius'
        label='Merge radius (meters)'
        hint='How far apart two markers can be and still count as the same point.'
        value={state.openSeaMapDedupeRadiusMeters ?? DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS}
        onChange={(meters) => dispatch({ type: 'setOpenSeaMapDedupeRadius', meters })}
        min={MIN_DEDUPE_RADIUS_METERS}
        step={10}
        integer
        disabled={!dedupeEnabled}
        dense
      />
    </>
  )
}
