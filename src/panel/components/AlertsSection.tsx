/**
 * The Alerts zone of the configuration panel: the proximity hazard alarm
 * and the route-corridor hazard scan, grouped under one collapsible
 * section. These are source-agnostic: they alarm on hazards from every
 * enabled data source.
 *
 * Collapsed by default so the panel reads cleanly when no alarm is
 * configured (a vessel that just wants the chart overlay should not
 * scroll past two empty alarm fieldsets to get to the footer). The
 * fieldsets stay mounted while collapsed so an in-progress numeric
 * draft survives a collapse-and-expand round trip.
 */

import type * as React from 'react'
import { memo } from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_PROXIMITY_ALARM_RADIUS_METERS } from '../../shared/proximity-radius.js'
import { DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS } from '../../shared/route-corridor.js'
import { DEFAULT_CLEARANCE_MARGIN_METERS, NO_FALLBACK_AIR_DRAFT_METERS } from '../../shared/bridge-clearance.js'
import type { PluginConfig } from '../../shared/types.js'
import ProximityAlarmFields from './ProximityAlarmFields.js'
import RouteHazardScanFields from './RouteHazardScanFields.js'
import BridgeAirDraftFields from './BridgeAirDraftFields.js'
import SectionBox from './SectionBox.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/**
 * The Alerts section shown in the configuration panel. Memoized so the 5 s
 * status-poll tick on the panel root does not cascade here: `state` and
 * `dispatch` both keep their identity across a tick.
 */
export default memo(function AlertsSection ({ state, dispatch }: Props): React.ReactElement {
  // Default-expanded only when the section has nothing to reveal: if
  // either alarm is already enabled, open the section so the operator
  // can see the live settings at a glance. SectionBox reads
  // defaultExpanded once on mount, which matches the
  // initial-state-from-saved-config semantic we want here.
  const alertsConfigured =
    state.enableProximityAlarms === true ||
    state.enableRouteHazardScan === true ||
    state.enableBridgeAirDraftCheck === true
  return (
    <SectionBox cardId='alerts' title='Alerts' defaultExpanded={alertsConfigured}>
      <ProximityAlarmFields
        enabled={state.enableProximityAlarms === true}
        radiusMeters={state.proximityAlarmRadiusMeters ?? DEFAULT_PROXIMITY_ALARM_RADIUS_METERS}
        onToggleEnabled={(enabled) => dispatch({ type: 'setProximityAlarmsEnabled', enabled })}
        onChangeRadius={(meters) => dispatch({ type: 'setProximityAlarmRadius', meters })}
      />
      <RouteHazardScanFields
        enabled={state.enableRouteHazardScan === true}
        corridorWidthMeters={state.routeCorridorWidthMeters ?? DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS}
        onToggleEnabled={(enabled) => dispatch({ type: 'setRouteHazardScanEnabled', enabled })}
        onChangeWidth={(meters) => dispatch({ type: 'setRouteCorridorWidth', meters })}
      />
      <BridgeAirDraftFields
        enabled={state.enableBridgeAirDraftCheck === true}
        airDraftMeters={state.vesselAirDraftMeters ?? NO_FALLBACK_AIR_DRAFT_METERS}
        marginMeters={state.bridgeClearanceMarginMeters ?? DEFAULT_CLEARANCE_MARGIN_METERS}
        onToggleEnabled={(enabled) => dispatch({ type: 'setBridgeAirDraftCheckEnabled', enabled })}
        onChangeAirDraft={(meters) => dispatch({ type: 'setVesselAirDraft', meters })}
        onChangeMargin={(meters) => dispatch({ type: 'setBridgeClearanceMargin', meters })}
      />
    </SectionBox>
  )
})
