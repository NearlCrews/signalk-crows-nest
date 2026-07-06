/**
 * The NGA World Port Index data-source card body. The World Port Index is one
 * flat worldwide dataset with no layer choice, so the card follows the same
 * shape as the USCG Light List card: an intro line, then the refresh period
 * and merge option under Advanced. The enable toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_REFRESH_HOURS,
  MAX_REFRESH_HOURS,
  MIN_REFRESH_HOURS
} from '../../shared/refresh-hours.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import Disclosure from './Disclosure.js'
import Fieldset from './Fieldset.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import NumberField from './NumberField.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the NGA World Port Index source. */
export default function WpiSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.wpiDedupe !== false

  return (
    <>
      <p style={S.hint}>
        Imports every port in the NGA World Port Index (Pub 150) worldwide.
        There is no layer choice; tune the refresh and merge behavior under
        Advanced.
      </p>
      <Disclosure>
        <Fieldset title='Refresh and freshness'>
          <NumberField
            id='ac-wpi-refresh-hours'
            label='Refresh period (hours)'
            hint={'How often the plugin re-downloads the whole World Port Index ' +
              'in the background. NGA publishes it quarterly, so the daily ' +
              'default is already conservative; the downloaded index is kept ' +
              'for offline use between refreshes.'}
            value={state.wpiRefreshHours ?? DEFAULT_REFRESH_HOURS}
            onChange={(hours) => dispatch({ type: 'setWpiRefreshHours', hours })}
            min={MIN_REFRESH_HOURS}
            max={MAX_REFRESH_HOURS}
            step={1}
            integer
          />
        </Fieldset>
        <MergeWithActiveCaptain
          sourceName='World Port Index'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setWpiDedupe', enabled })}
          radiusMeters={state.wpiDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setWpiDedupeRadius', meters })}
          radiusInputId='ac-wpi-dedupe-radius'
        />
      </Disclosure>
    </>
  )
}
