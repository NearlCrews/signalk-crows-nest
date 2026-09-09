/**
 * The bridge air-draft check controls: an opt-in toggle plus two numeric
 * settings, the fallback vessel air draft and the clearance safety margin,
 * grouped in a shared `FieldGroup`. Both inputs are disabled while the toggle
 * is off, because the settings then have no effect. Neither field snaps a
 * typed value: a clearance check needs the exact figure the operator enters.
 */

import type * as React from 'react'
import { Checkbox, FieldGroup } from 'signalk-nearlcrews-ui'
import LengthField from './LengthField.js'
import {
  MIN_CLEARANCE_MARGIN_METERS,
  MAX_CLEARANCE_MARGIN_METERS,
  NO_FALLBACK_AIR_DRAFT_METERS
} from '../../shared/bridge-clearance.js'

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
    <FieldGroup legend='Bridge air-draft check'>
      <Checkbox
        label='Warn when an approaching bridge is too low for the vessel'
        description={
          <>
            When enabled, the plugin compares each approaching bridge, and each
            bridge on the active route ahead, against the vessel air draft, and
            raises a Signal K notification when the charted clearance would not
            clear the vessel. The route-ahead warning also needs the route-corridor
            hazard scan enabled above.
          </>
        }
        checked={enabled}
        onChange={(event) => onToggleEnabled(event.target.checked)}
      />
      <LengthField
        label='Vessel air draft'
        hint="0 = use the vessel's design.airHeight from the Signal K data model. Set a value here only as a fallback for a vessel that does not report design.airHeight."
        valueMeters={airDraftMeters}
        onChangeMeters={onChangeAirDraft}
        minMeters={NO_FALLBACK_AIR_DRAFT_METERS}
        disabled={!enabled}
        dense
      />
      <LengthField
        label='Clearance margin'
        hint='Headroom added to the air draft before the comparison, covering tide, datum, and loading. A bridge warns when its charted clearance is at or below the air draft plus this margin.'
        valueMeters={marginMeters}
        onChangeMeters={onChangeMargin}
        minMeters={MIN_CLEARANCE_MARGIN_METERS}
        maxMeters={MAX_CLEARANCE_MARGIN_METERS}
        disabled={!enabled}
        dense
      />
    </FieldGroup>
  )
}
