/**
 * The USCG Local Notice to Mariners data-source card body. Field order follows
 * the same convention every per-source card uses: import layers (LNM has no
 * layer choice; every published notice layer is imported), then the refresh
 * period (NAVCEN bulk re-download cadence), then the merge option. The enable
 * toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import { FieldGroup, Text } from 'signalk-nearlcrews-ui'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_USCG_LNM_DEBOUNCE_SECONDS } from '../../shared/bbox-debounce-bounds.js'
import type { PluginConfig } from '../../shared/types.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import RefreshSecondsField from './RefreshSecondsField.js'
import SourceAdvanced from './SourceAdvanced.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the USCG Local Notice to Mariners source. */
export default function UscgLnmSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.uscgLnmDedupe !== false

  return (
    <>
      <Text as='p' tone='muted' size='sm'>
        Imports live Local Notice to Mariners layers from USCG NAVCEN: reported
        hazards and obstructions, discrepant and off-station aids, temporary
        changes, dredging and marine construction, bridge notices, and general
        marine-safety notices. Hazard and discrepant-aid notices are marked as
        hazards so the proximity and route alarms pick them up. US waters only.
      </Text>
      <SourceAdvanced>
        <FieldGroup legend='Refresh and freshness'>
          <RefreshSecondsField
            // LNM re-downloads whole notice files on a schedule rather than
            // revalidating a per-viewport result, so it replaces the shared
            // description instead of appending to it.
            description={'How often the plugin re-downloads the NAVCEN notice files in ' +
            'the background. NAVCEN republishes the notices about every 15 ' +
            'minutes, so the default matches that cadence; leave at 0 to use ' +
            'the default.'}
            value={state.uscgLnmRefreshSeconds ?? DEFAULT_USCG_LNM_DEBOUNCE_SECONDS}
            onChange={(seconds) => dispatch({ type: 'setUscgLnmRefreshSeconds', seconds })}
          />
        </FieldGroup>
        <MergeWithActiveCaptain
          sourceName='USCG Local Notice to Mariners'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setUscgLnmDedupe', enabled })}
          radiusMeters={state.uscgLnmDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setUscgLnmDedupeRadius', meters })}
        />
      </SourceAdvanced>
    </>
  )
}
