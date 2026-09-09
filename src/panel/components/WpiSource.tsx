/**
 * The NGA World Port Index data-source card body. The World Port Index is one
 * flat worldwide dataset with no layer choice, so the card follows the same
 * shape as the USCG Light List card: an intro line, then the refresh period
 * and merge option under Advanced. The enable toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import { FieldGroup, Text } from 'signalk-nearlcrews-ui'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_REFRESH_HOURS } from '../../shared/refresh-hours.js'
import type { PluginConfig } from '../../shared/types.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import RefreshHoursField from './RefreshHoursField.js'
import SourceAdvanced from './SourceAdvanced.js'

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
      <Text as='p' tone='muted' size='sm'>
        Imports every port in the NGA World Port Index (Pub 150) worldwide.
        There is no layer choice; tune the refresh and merge behavior under
        Advanced.
      </Text>
      <SourceAdvanced>
        <FieldGroup legend='Refresh and freshness'>
          <RefreshHoursField
            upstreamHint={'NGA publishes the World Port Index quarterly, so the ' +
            'daily default is already conservative.'}
            value={state.wpiRefreshHours ?? DEFAULT_REFRESH_HOURS}
            onChange={(hours) => dispatch({ type: 'setWpiRefreshHours', hours })}
          />
        </FieldGroup>
        <MergeWithActiveCaptain
          sourceName='World Port Index'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setWpiDedupe', enabled })}
          radiusMeters={state.wpiDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setWpiDedupeRadius', meters })}
        />
      </SourceAdvanced>
    </>
  )
}
