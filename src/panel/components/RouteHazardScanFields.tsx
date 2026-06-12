/**
 * The route-corridor hazard scan controls: an opt-in toggle and the corridor
 * width. The fieldset, legend, toggle, and hint shell come from
 * `ToggleFieldset`; this component slots its width LengthField as the
 * children, disabled while the toggle is off because the setting then has no
 * effect.
 */

import type * as React from 'react'
import LengthField from './LengthField.js'
import ToggleFieldset from './ToggleFieldset.js'
import { MIN_ROUTE_CORRIDOR_WIDTH_METERS } from '../../shared/route-corridor.js'

interface Props {
  enabled: boolean
  corridorWidthMeters: number
  onToggleEnabled: (enabled: boolean) => void
  onChangeWidth: (meters: number) => void
}

/** The route-corridor hazard scan controls shown in the configuration panel. */
export default function RouteHazardScanFields ({
  enabled,
  corridorWidthMeters,
  onToggleEnabled,
  onChangeWidth
}: Props): React.ReactElement {
  return (
    <ToggleFieldset
      title='Route-corridor hazard scan'
      toggleLabel='Flag hazards, bridges, and locks along the active route'
      toggleHint='When enabled, and the vessel has an active Course API route, the plugin scans the route ahead and raises a Signal K notification for each hazard, bridge, and lock within the corridor width of the route, with its along-track distance and ETA.'
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    >
      <LengthField
        id='ac-route-corridor-width'
        label='Corridor width'
        hint='A point of interest within this distance either side of the route line is treated as on the route.'
        valueMeters={corridorWidthMeters}
        onChangeMeters={onChangeWidth}
        minMeters={MIN_ROUTE_CORRIDOR_WIDTH_METERS}
        step={50}
        integer
        disabled={!enabled}
        dense
      />
    </ToggleFieldset>
  )
}
