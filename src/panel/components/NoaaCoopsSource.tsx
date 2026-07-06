/**
 * The NOAA CO-OPS data-source card body. Field order follows the same
 * convention every per-source card uses: import layers (which station families
 * to bring in), then the refresh-period field (the background re-download
 * cadence), then the merge option. The enable toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_REFRESH_HOURS,
  MAX_REFRESH_HOURS,
  MIN_REFRESH_HOURS
} from '../../shared/refresh-hours.js'
import type { PluginConfig } from '../../shared/types.js'
import Disclosure from './Disclosure.js'
import Fieldset from './Fieldset.js'
import IncludeToggles from './IncludeToggles.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import NumberField from './NumberField.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the NOAA CO-OPS source. */
export default function NoaaCoopsSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.noaaCoopsDedupe !== false
  // Both station families default on; an absent flag imports the family.
  const includeTide = state.noaaCoopsIncludeTideStations !== false
  const includeCurrent = state.noaaCoopsIncludeCurrentStations !== false

  return (
    <>
      <IncludeToggles
        legend='Import layers'
        emptyWarning='Choose at least one station type; with both off the source is enabled but imports nothing.'
        options={[
          {
            id: 'noaa-coops-tide',
            label: 'Tide (water level) stations',
            checked: includeTide,
            onChange: (enabled) => dispatch({ type: 'setNoaaCoopsIncludeTideStations', enabled })
          },
          {
            id: 'noaa-coops-current',
            label: 'Current stations',
            checked: includeCurrent,
            onChange: (enabled) => dispatch({ type: 'setNoaaCoopsIncludeCurrentStations', enabled })
          }
        ]}
      />
      <Disclosure>
        <Fieldset title='Refresh'>
          <NumberField
            id='ac-noaa-coops-refresh-hours'
            label='Refresh period (hours)'
            hint='How often the plugin re-downloads the CO-OPS station lists in the background. The lists change rarely, so a long period costs almost nothing.'
            value={state.noaaCoopsRefreshHours ?? DEFAULT_REFRESH_HOURS}
            onChange={(hours) => dispatch({ type: 'setNoaaCoopsRefreshHours', hours })}
            min={MIN_REFRESH_HOURS}
            max={MAX_REFRESH_HOURS}
            step={1}
            integer
          />
        </Fieldset>
        <MergeWithActiveCaptain
          sourceName='NOAA CO-OPS'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setNoaaCoopsDedupe', enabled })}
          radiusMeters={state.noaaCoopsDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setNoaaCoopsDedupeRadius', meters })}
          radiusInputId='ac-noaa-coops-dedupe-radius'
        />
      </Disclosure>
    </>
  )
}
