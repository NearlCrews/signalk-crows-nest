/**
 * The bridge air-draft check controls: an opt-in toggle plus two numeric
 * settings, the fallback vessel air draft and the clearance safety margin.
 *
 * The fieldset, legend, toggle, and hint shell come from `ToggleFieldset`;
 * this component slots both LengthFields as the children. Both inputs are
 * disabled while the toggle is off, because the settings then have no
 * effect.
 */

import type * as React from 'react'
import LengthField from './LengthField.js'
import ToggleFieldset from './ToggleFieldset.js'
import {
  MIN_CLEARANCE_MARGIN_METERS,
  MAX_CLEARANCE_MARGIN_METERS,
  NO_FALLBACK_AIR_DRAFT_METERS
} from '../../shared/bridge-clearance.js'
import { HALF_UNIT_STEP } from '../step-sizes.js'

interface Props {
  enabled: boolean
  airDraftMeters: number
  marginMeters: number
  onToggleEnabled: (enabled: boolean) => void
  onChangeAirDraft: (meters: number) => void
  onChangeMargin: (meters: number) => void
}

/** The bridge air-draft check controls shown in the configuration panel. */
export default function BridgeAirDraftFields ({
  enabled,
  airDraftMeters,
  marginMeters,
  onToggleEnabled,
  onChangeAirDraft,
  onChangeMargin
}: Props): React.ReactElement {
  return (
    <ToggleFieldset
      title='Bridge air-draft check'
      toggleLabel='Warn when an approaching bridge is too low for the vessel'
      toggleHint={
        <>
          When enabled, the plugin compares each approaching bridge, and each
          bridge on the active route ahead, against the vessel air draft, and
          raises a Signal K notification when the charted clearance would not
          clear the vessel. The route-ahead warning also needs the route-corridor
          hazard scan enabled above.
        </>
      }
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    >
      <LengthField
        id='ac-bridge-air-draft'
        label='Vessel air draft'
        hint="0 = use the vessel's design.airHeight from the Signal K data model. Set a value here only as a fallback for a vessel that does not report design.airHeight."
        valueMeters={airDraftMeters}
        onChangeMeters={onChangeAirDraft}
        minMeters={NO_FALLBACK_AIR_DRAFT_METERS}
        step={HALF_UNIT_STEP}
        disabled={!enabled}
        dense
      />
      <LengthField
        id='ac-bridge-clearance-margin'
        label='Clearance margin'
        hint='Headroom added to the air draft before the comparison, covering tide, datum, and loading. A bridge warns when its charted clearance is at or below the air draft plus this margin.'
        valueMeters={marginMeters}
        onChangeMeters={onChangeMargin}
        minMeters={MIN_CLEARANCE_MARGIN_METERS}
        maxMeters={MAX_CLEARANCE_MARGIN_METERS}
        step={HALF_UNIT_STEP}
        disabled={!enabled}
        dense
      />
    </ToggleFieldset>
  )
}
