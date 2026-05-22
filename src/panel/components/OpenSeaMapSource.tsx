/**
 * The OpenSeaMap data-source card body: the Overpass API endpoint field and
 * the seamark feature-group checklist. It is the `children` of the OpenSeaMap
 * `DataSourceCard` in the accordion.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_OPENSEAMAP_ENDPOINT } from '../normalize-config.js'
import { SEAMARK_GROUP_IDS } from '../../shared/seamark-groups.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import EndpointUrlField from './EndpointUrlField.js'
import SeamarkGroups from './SeamarkGroups.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the OpenSeaMap source. */
export default function OpenSeaMapSource ({ state, dispatch }: Props): React.ReactElement {
  const selected = state.openSeaMapSeamarkGroups ?? []

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
      <label style={S.proximityToggle}>
        <input
          type='checkbox'
          style={S.checkbox}
          // Dedupe defaults on: an absent value is treated as checked.
          checked={state.openSeaMapDedupe !== false}
          onChange={(e) => dispatch({ type: 'setOpenSeaMapDedupe', enabled: e.target.checked })}
        />
        Merge OpenSeaMap markers that duplicate an ActiveCaptain marker
      </label>
      <p style={S.hint}>
        When enabled, an OpenSeaMap point of interest close to an ActiveCaptain
        point of the same type is merged into it, so one physical feature is
        shown once. The surviving marker records every source that reported it.
      </p>
    </>
  )
}
