/**
 * The USCG Light List data-source card body. Field order follows the same
 * convention every per-source card uses: import layers (USCG has none;
 * every NAVCEN record is imported), then the refresh-period field
 * (NAVCEN bulk re-download cadence), then the update-year filter, then
 * the merge option. The enable toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import { FieldGroup, Text } from 'signalk-nearlcrews-ui'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_MINIMUM_YEAR } from '../../shared/year-filter.js'
import { DEFAULT_REFRESH_HOURS } from '../../shared/refresh-hours.js'
import type { PluginConfig } from '../../shared/types.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import MinimumYearField from './MinimumYearField.js'
import RefreshHoursField from './RefreshHoursField.js'
import SourceAdvanced from './SourceAdvanced.js'

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
      <Text as='p' tone='muted' size='sm'>
        Imports every US Aid to Navigation record from the USCG Light List.
        There is no layer choice; tune the refresh and merge behavior under
        Advanced.
      </Text>
      <SourceAdvanced>
        <FieldGroup legend='Refresh and freshness'>
          <RefreshHoursField
            upstreamHint={'The NAVCEN district files change as aids are established, ' +
            'moved, or discontinued, so a shorter period picks up a new aid sooner.'}
            value={state.uscgLightListRefreshHours ?? DEFAULT_REFRESH_HOURS}
            onChange={(hours) => dispatch({ type: 'setUscgLightListRefreshHours', hours })}
          />
          <MinimumYearField
            label='Earliest update year'
            hint={'Hide records whose last USCG modification date is older than ' +
            'this year. Leave at 0 to import every record. Records with no ' +
            'recorded modification date are always included.'}
            value={state.uscgLightListMinimumUpdateYear ?? DEFAULT_MINIMUM_YEAR}
            onChange={(year) => dispatch({ type: 'setUscgLightListMinimumUpdateYear', year })}
          />
        </FieldGroup>
        <MergeWithActiveCaptain
          sourceName='USCG Light List'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setUscgLightListDedupe', enabled })}
          radiusMeters={state.uscgLightListDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setUscgLightListDedupeRadius', meters })}
        />
      </SourceAdvanced>
    </>
  )
}
