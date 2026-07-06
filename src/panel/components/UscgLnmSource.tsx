/**
 * The USCG Local Notice to Mariners data-source card body. Field order follows
 * the same convention every per-source card uses: import layers (LNM has no
 * layer choice; every published notice layer is imported), then the refresh
 * period (NAVCEN bulk re-download cadence), then the merge option. The enable
 * toggle lives on the card header.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_USCG_LNM_DEBOUNCE_SECONDS,
  MAX_BBOX_DEBOUNCE_SECONDS,
  MIN_BBOX_DEBOUNCE_SECONDS
} from '../../shared/bbox-debounce-bounds.js'
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

/** The configuration fields for the USCG Local Notice to Mariners source. */
export default function UscgLnmSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.uscgLnmDedupe !== false

  return (
    <>
      <p style={S.hint}>
        Imports live Local Notice to Mariners layers from USCG NAVCEN: reported
        hazards and obstructions, discrepant and off-station aids, temporary
        changes, dredging and marine construction, bridge notices, and general
        marine-safety notices. Hazard and discrepant-aid notices are marked as
        hazards so the proximity and route alarms pick them up. US waters only.
      </p>
      <Disclosure>
        <Fieldset title='Refresh and freshness'>
          <NumberField
            id='ac-uscg-lnm-refresh-seconds'
            label='Refresh period (seconds)'
            hint={'How often the plugin re-downloads the NAVCEN notice files in ' +
              'the background. NAVCEN republishes the notices about every 15 ' +
              'minutes, so the default matches that cadence; leave at 0 to use ' +
              'the default.'}
            value={state.uscgLnmRefreshSeconds ?? DEFAULT_USCG_LNM_DEBOUNCE_SECONDS}
            onChange={(seconds) => dispatch({ type: 'setUscgLnmRefreshSeconds', seconds })}
            min={MIN_BBOX_DEBOUNCE_SECONDS}
            max={MAX_BBOX_DEBOUNCE_SECONDS}
            step={30}
            integer
          />
        </Fieldset>
        <MergeWithActiveCaptain
          sourceName='USCG Local Notice to Mariners'
          enabled={dedupeEnabled}
          onToggleEnabled={(enabled) => dispatch({ type: 'setUscgLnmDedupe', enabled })}
          radiusMeters={state.uscgLnmDedupeRadiusMeters}
          onChangeRadius={(meters) => dispatch({ type: 'setUscgLnmDedupeRadius', meters })}
          radiusInputId='ac-uscg-lnm-dedupe-radius'
        />
      </Disclosure>
    </>
  )
}
