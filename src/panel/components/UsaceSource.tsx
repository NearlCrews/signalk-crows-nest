/**
 * The USACE locks and dams data-source card body. Field order follows the same
 * convention every per-source card uses: import layers (the lock and dam
 * toggles), then the refresh period (per-bbox debounce in seconds), then the
 * merge option (dedupe toggle). The enable toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_USACE_DEBOUNCE_SECONDS } from '../../shared/bbox-debounce-bounds.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import Disclosure from './Disclosure.js'
import Fieldset from './Fieldset.js'
import IncludeToggles from './IncludeToggles.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import RefreshSecondsField from './RefreshSecondsField.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the USACE locks and dams source. */
export default function UsaceSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.usaceDedupe !== false
  // Locks default on; dams default off (heavy).
  const includeLocks = state.usaceIncludeLocks !== false
  const includeDams = state.usaceIncludeDams === true

  return (
    <>
      <IncludeToggles
        legend='Import structures'
        emptyWarning='Choose at least one structure type; with both off the source is enabled but imports nothing.'
        options={[
          {
            id: 'usace-locks',
            label: 'Locks',
            checked: includeLocks,
            onChange: (enabled) => dispatch({ type: 'setUsaceIncludeLocks', enabled })
          },
          {
            id: 'usace-dams',
            label: 'Dams',
            checked: includeDams,
            onChange: (enabled) => dispatch({ type: 'setUsaceIncludeDams', enabled })
          }
        ]}
        footnote={
          <p style={S.hintBelow}>
            Dams default off because the National Inventory of Dams lists tens of
            thousands of dams nationwide, most of them not on navigable water,
            which slows the chartplotter and obscures the locks.
          </p>
        }
      />
      <Disclosure>
        <Fieldset title='Refresh and freshness'>
          <RefreshSecondsField
            id='ac-usace-refresh-seconds'
            label='Refresh period (seconds)'
            upstreamHint={'USACE locks and dams change on an infrastructure ' +
              'timescale, so the 30 minute default only spares the ArcGIS ' +
              'services from re-serving identical structures; raise it freely.'}
            value={state.usaceRefreshSeconds ?? DEFAULT_USACE_DEBOUNCE_SECONDS}
            onChange={(seconds) => dispatch({ type: 'setUsaceRefreshSeconds', seconds })}
          />
        </Fieldset>
        <MergeWithActiveCaptain
          sourceName='USACE'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setUsaceDedupe', enabled })}
          radiusMeters={state.usaceDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setUsaceDedupeRadius', meters })}
          radiusInputId='ac-usace-dedupe-radius'
        />
      </Disclosure>
    </>
  )
}
