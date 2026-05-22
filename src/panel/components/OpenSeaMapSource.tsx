/**
 * The OpenSeaMap data-source card body: the Overpass API endpoint field, the
 * seamark feature-group checklist, the dedupe toggle, and the dedupe merge
 * radius. It is the `children` of the OpenSeaMap `DataSourceCard` in the
 * accordion.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_OPENSEAMAP_DEDUPE_RADIUS_METERS,
  DEFAULT_OPENSEAMAP_ENDPOINT
} from '../normalize-config.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import EndpointUrlField from './EndpointUrlField.js'
import NumberField from './NumberField.js'
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
