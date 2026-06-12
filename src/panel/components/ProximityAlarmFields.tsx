/**
 * The proximity hazard alarm controls: an opt-in toggle and the alarm radius.
 * The fieldset, legend, toggle, and hint shell come from `ToggleFieldset`;
 * this component slots its radius LengthField as the children, disabled while
 * the toggle is off because the setting then has no effect.
 */

import type * as React from 'react'
import LengthField from './LengthField.js'
import ToggleFieldset from './ToggleFieldset.js'
import { MIN_PROXIMITY_ALARM_RADIUS_METERS } from '../../shared/proximity-radius.js'

interface Props {
  enabled: boolean
  radiusMeters: number
  onToggleEnabled: (enabled: boolean) => void
  onChangeRadius: (meters: number) => void
}

/** The proximity hazard alarm controls shown in the configuration panel. */
export default function ProximityAlarmFields ({
  enabled,
  radiusMeters,
  onToggleEnabled,
  onChangeRadius
}: Props): React.ReactElement {
  return (
    <ToggleFieldset
      title='Proximity hazard alarms'
      toggleLabel='Emit an alarm when the vessel nears a hazard'
      toggleHint='When enabled, the plugin subscribes to the vessel position, scans for nearby hazards, and raises a Signal K notification for each hazard within the alarm radius.'
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    >
      <LengthField
        id='ac-proximity-alarm-radius'
        label='Alarm radius'
        hint='A hazard closer than this distance to the vessel raises a proximity alarm.'
        valueMeters={radiusMeters}
        onChangeMeters={onChangeRadius}
        minMeters={MIN_PROXIMITY_ALARM_RADIUS_METERS}
        step={50}
        integer
        disabled={!enabled}
        dense
      />
    </ToggleFieldset>
  )
}
