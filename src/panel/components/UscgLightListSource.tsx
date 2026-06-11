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
import { DEFAULT_MINIMUM_YEAR } from '../../shared/year-filter.js'
import {
  DEFAULT_REFRESH_HOURS,
  MAX_REFRESH_HOURS,
  MIN_REFRESH_HOURS
} from '../../shared/refresh-hours.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
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
      <fieldset style={S.group}>
        <legend style={S.groupTitle}>Refresh and freshness</legend>
        <NumberField
          id='ac-uscg-light-list-refresh-hours'
          label='Refresh period (hours)'
          hint='How often the plugin re-downloads the NAVCEN district files in the background. Longer periods reduce traffic; shorter periods pick up new aids sooner.'
          value={state.uscgLightListRefreshHours ?? DEFAULT_REFRESH_HOURS}
          onChange={(hours) => dispatch({ type: 'setUscgLightListRefreshHours', hours })}
          min={MIN_REFRESH_HOURS}
          max={MAX_REFRESH_HOURS}
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
      </fieldset>
      <MergeWithActiveCaptain
        sourceName='USCG Light List'
        enabled={dedupeEnabled}
        onToggleEnabled={(enabled) => dispatch({ type: 'setUscgLightListDedupe', enabled })}
        radiusMeters={state.uscgLightListDedupeRadiusMeters}
        onChangeRadius={(meters) => dispatch({ type: 'setUscgLightListDedupeRadius', meters })}
        radiusInputId='ac-uscg-light-list-dedupe-radius'
      />
    </>
  )
}
