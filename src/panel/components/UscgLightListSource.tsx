/**
 * The USCG Light List data-source card body. Field order follows the same
 * convention every per-source card uses: import layers (USCG has none;
 * every NAVCEN record is imported), then the refresh-period field
 * (NAVCEN bulk re-download cadence), then the update-year filter, then
 * the merge option. The enable toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_MINIMUM_YEAR,
  DEFAULT_USCG_LIGHT_LIST_REFRESH_HOURS,
  MAX_USCG_LIGHT_LIST_REFRESH_HOURS,
  MIN_USCG_LIGHT_LIST_REFRESH_HOURS
} from '../normalize-config.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import MinimumYearField from './MinimumYearField.js'
import NumberField from './NumberField.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the USCG Light List source. */
export default function UscgLightListSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.uscgLightListDedupe !== false

  return (
    <>
      <NumberField
        id='ac-uscg-light-list-refresh-hours'
        label='Refresh period (hours)'
        hint='How often the plugin re-downloads the NAVCEN district files in the background. Longer periods reduce traffic; shorter periods pick up new aids sooner.'
        value={state.uscgLightListRefreshHours ?? DEFAULT_USCG_LIGHT_LIST_REFRESH_HOURS}
        onChange={(hours) => dispatch({ type: 'setUscgLightListRefreshHours', hours })}
        min={MIN_USCG_LIGHT_LIST_REFRESH_HOURS}
        max={MAX_USCG_LIGHT_LIST_REFRESH_HOURS}
        step={1}
        integer
      />
      <MinimumYearField
        id='ac-uscg-light-list-minimum-update-year'
        label='Earliest update year'
        hint={'Hide records whose last USCG modification date is older than ' +
          'this year. Leave at 0 to import every record. Records with no ' +
          'recorded modification date are always included.'}
        value={state.uscgLightListMinimumUpdateYear ?? DEFAULT_MINIMUM_YEAR}
        onChange={(year) => dispatch({ type: 'setUscgLightListMinimumUpdateYear', year })}
      />
      <label style={S.checkboxRow}>
        <input
          type='checkbox'
          style={S.checkbox}
          checked={dedupeEnabled}
          onChange={(e) => dispatch({ type: 'setUscgLightListDedupe', enabled: e.target.checked })}
        />
        Merge USCG Light List markers that duplicate an ActiveCaptain marker
      </label>
      <p style={S.hint}>
        When enabled, a USCG Light List point of interest close to an
        ActiveCaptain point of the same type is merged into it, so one
        physical feature is shown once. The surviving marker records every
        source that reported it.
      </p>
    </>
  )
}
