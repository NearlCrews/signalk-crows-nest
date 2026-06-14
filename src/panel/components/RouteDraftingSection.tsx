/**
 * The Route drafting zone of the configuration panel: the AI route-draft
 * master opt-in plus the OpenRouter credentials, then the vessel basics, with
 * the budget, depth, fuel, and routing tuning tucked under an Advanced
 * disclosure so the default view stays short.
 *
 * Like `AlertsSection`, this takes the working config and `dispatch` and derives
 * its values via `normalizeRouteDraftConfig`, so it reads the same fully-clamped
 * values the runtime sees and dispatches reducer actions directly. Memoized so
 * the panel root's status-poll tick does not cascade here: `state` and
 * `dispatch` keep their identity across a tick.
 *
 * The whole feature is opt-in: with the master toggle off, every field below is
 * disabled. Only the master section carries a toggle; Vessel and the Advanced
 * groups are plain fieldsets, so there is one enable, not four.
 */

import type * as React from 'react'
import { memo } from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import type { PluginConfig } from '../../shared/types.js'
import {
  MAX_BURN_LITERS_PER_HOUR,
  MAX_CRUISE_SPEED_KN,
  MAX_DRAFT_METERS,
  MAX_MAX_CALLS_PER_DAY,
  MAX_MAX_LEG_NM,
  MAX_RESERVE_PERCENT,
  MAX_SAFETY_MARGIN_METERS,
  MAX_STANDOFF_NM,
  MAX_TACKING_ANGLE_DEG,
  MIN_BURN_LITERS_PER_HOUR,
  MIN_CRUISE_SPEED_KN,
  MIN_DRAFT_METERS,
  MIN_MAX_CALLS_PER_DAY,
  MIN_MAX_LEG_NM,
  MIN_RESERVE_PERCENT,
  MIN_SAFETY_MARGIN_METERS,
  MIN_STANDOFF_NM,
  MIN_TACKING_ANGLE_DEG,
  PROPULSION_CHOICES,
  normalizeRouteDraftConfig
} from '../../route-draft/config.js'
import Disclosure from './Disclosure.js'
import Fieldset from './Fieldset.js'
import LabeledField from './LabeledField.js'
import LengthField from './LengthField.js'
import NumberField from './NumberField.js'
import SectionBox from './SectionBox.js'
import SegmentedControl from './SegmentedControl.js'
import ToggleFieldset from './ToggleFieldset.js'
import { S } from '../styles.js'
import { HALF_UNIT_STEP } from '../step-sizes.js'

/** Stable id linking the masked key label to its input. */
const API_KEY_FIELD_ID = 'ac-route-draft-api-key'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/**
 * The Route drafting section shown in the configuration panel. Reads its values
 * from the normalized route-draft config, so the route-draft keys' optionality
 * on `PluginConfig` never reaches the field props.
 */
export default memo(function RouteDraftingSection ({ state, dispatch }: Props): React.ReactElement {
  const config = normalizeRouteDraftConfig(state)
  const enabled = config.routeDraftEnabled

  return (
    <SectionBox cardId='route-drafting' title='Route drafting' defaultExpanded={enabled}>
      <ToggleFieldset
        title='AI route drafting'
        toggleLabel='Draft passages from a plain-language request (admin only)'
        toggleHint={
          <>
            When enabled, Binnacle can ask this plugin to turn a plain-language
            passage request into a drafted route, checked against NOAA ENC
            charted depth areas, charted land, and charted point hazards, with a
            deterministic fuel estimate. Drafting spends the OpenRouter budget
            and needs SignalK admin access. The route is always a draft the
            navigator verifies on the chart before saving.
          </>
        }
        enabled={enabled}
        onToggleEnabled={(value) => dispatch({ type: 'setRouteDraftEnabled', enabled: value })}
      >
        <LabeledField
          id={API_KEY_FIELD_ID}
          label='OpenRouter API key'
          hint='Stored unencrypted in the plugin configuration. Create a key at openrouter.ai. Leave blank to keep drafting disabled.'
          dense
        >
          {(controlProps) => (
            <input
              {...controlProps}
              type='password'
              autoComplete='off'
              spellCheck={false}
              style={S.inputWide}
              disabled={!enabled}
              value={config.routeDraftOpenRouterApiKey}
              onChange={(e) => dispatch({ type: 'setRouteDraftOpenRouterApiKey', key: e.target.value })}
            />
          )}
        </LabeledField>
        <LabeledField
          id='ac-route-draft-model'
          label='OpenRouter model slug'
          hint='The model OpenRouter routes the draft to. The default supports the strict structured output the draft contract needs.'
          dense
        >
          {(controlProps) => (
            <input
              {...controlProps}
              type='text'
              autoComplete='off'
              spellCheck={false}
              style={S.inputWide}
              disabled={!enabled}
              value={config.routeDraftModel}
              onChange={(e) => dispatch({ type: 'setRouteDraftModel', model: e.target.value })}
            />
          )}
        </LabeledField>
      </ToggleFieldset>

      <Fieldset
        title='Vessel'
        hint='Sets the minimal safe depth the charted depth-area check flags a leg against, and the point of sail for a sailing draft.'
      >
        <div style={S.labelledInputRow}>
          <span style={S.label}>Propulsion</span>
          <SegmentedControl
            legend='Vessel propulsion'
            choices={PROPULSION_CHOICES}
            value={config.routeDraftPropulsion}
            onChange={(propulsion) => dispatch({ type: 'setRouteDraftPropulsion', propulsion })}
          />
        </div>
        <LengthField
          id='ac-route-draft-draft'
          label='Vessel draft'
          hint='Deepest point of the hull below the waterline. 0 reads design.draft.value.maximum from the data model when present.'
          valueMeters={config.routeDraftDraftMeters}
          onChangeMeters={(meters) => dispatch({ type: 'setRouteDraftDraftMeters', meters })}
          minMeters={MIN_DRAFT_METERS}
          maxMeters={MAX_DRAFT_METERS}
          step={HALF_UNIT_STEP}
          disabled={!enabled}
          dense
        />
      </Fieldset>

      <Disclosure>
        <Fieldset title='Budget'>
          <NumberField
            id='ac-route-draft-max-calls'
            label='Maximum drafts per day'
            hint='Caps the number of drafting calls per UTC day, counting failed attempts too. It bounds the number of calls, not the dollar spend.'
            value={config.routeDraftMaxCallsPerDay}
            onChange={(calls) => dispatch({ type: 'setRouteDraftMaxCallsPerDay', calls })}
            min={MIN_MAX_CALLS_PER_DAY}
            max={MAX_MAX_CALLS_PER_DAY}
            step={1}
            integer
            disabled={!enabled}
            dense
          />
        </Fieldset>
        <Fieldset title='Depth and sailing'>
          <LengthField
            id='ac-route-draft-safety-margin'
            label='Depth safety margin'
            hint='Under-keel clearance added to the draft before the charted-depth comparison. A leg flags shallow when the charted depth area is at or below the draft plus this margin.'
            valueMeters={config.routeDraftSafetyMarginMeters}
            onChangeMeters={(meters) => dispatch({ type: 'setRouteDraftSafetyMarginMeters', meters })}
            minMeters={MIN_SAFETY_MARGIN_METERS}
            maxMeters={MAX_SAFETY_MARGIN_METERS}
            step={HALF_UNIT_STEP}
            disabled={!enabled}
            dense
          />
          <NumberField
            id='ac-route-draft-tacking-angle'
            label='Tacking angle (degrees)'
            hint='Closest the vessel points to the true wind, in degrees. Advisory guidance to the model for a sailing passage; not enforced by the check.'
            value={config.routeDraftTackingAngleDeg}
            onChange={(degrees) => dispatch({ type: 'setRouteDraftTackingAngleDeg', degrees })}
            min={MIN_TACKING_ANGLE_DEG}
            max={MAX_TACKING_ANGLE_DEG}
            step={5}
            disabled={!enabled}
            dense
          />
        </Fieldset>
        <Fieldset title='Fuel'>
          <NumberField
            id='ac-route-draft-cruise-speed'
            label='Cruise speed (knots)'
            hint='Speed made good under power at cruise, used with the burn rate to derive fuel per nautical mile.'
            value={config.routeDraftCruiseSpeedKn}
            onChange={(knots) => dispatch({ type: 'setRouteDraftCruiseSpeedKn', knots })}
            min={MIN_CRUISE_SPEED_KN}
            max={MAX_CRUISE_SPEED_KN}
            step={HALF_UNIT_STEP}
            disabled={!enabled}
            dense
          />
          <NumberField
            id='ac-route-draft-burn'
            label='Burn at cruise (liters per hour)'
            hint='Fuel consumed per hour at cruise speed, in liters. Stored in liters; the fuel estimate works in liters.'
            value={config.routeDraftBurnLitersPerHour}
            onChange={(litersPerHour) => dispatch({ type: 'setRouteDraftBurnLitersPerHour', litersPerHour })}
            min={MIN_BURN_LITERS_PER_HOUR}
            max={MAX_BURN_LITERS_PER_HOUR}
            step={HALF_UNIT_STEP}
            disabled={!enabled}
            dense
          />
          <NumberField
            id='ac-route-draft-reserve'
            label='Reserve (percent)'
            hint='Fraction of the fuel aboard held back before the margin is reported, covering an unplanned diversion.'
            value={config.routeDraftReservePercent}
            onChange={(percent) => dispatch({ type: 'setRouteDraftReservePercent', percent })}
            min={MIN_RESERVE_PERCENT}
            max={MAX_RESERVE_PERCENT}
            step={5}
            disabled={!enabled}
            dense
          />
        </Fieldset>
        <Fieldset title='Routing'>
          <NumberField
            id='ac-route-draft-standoff'
            label='Standoff (nautical miles)'
            hint='Minimum offing kept off charted land. A leg whose nearest charted-land approach is under this distance is flagged.'
            value={config.routeDraftStandoffNm}
            onChange={(nauticalMiles) => dispatch({ type: 'setRouteDraftStandoffNm', nauticalMiles })}
            min={MIN_STANDOFF_NM}
            max={MAX_STANDOFF_NM}
            step={HALF_UNIT_STEP}
            disabled={!enabled}
            dense
          />
          <NumberField
            id='ac-route-draft-max-leg'
            label='Maximum leg (nautical miles)'
            hint='Longest leg the model is asked to draw before inserting a turning waypoint.'
            value={config.routeDraftMaxLegNm}
            onChange={(nauticalMiles) => dispatch({ type: 'setRouteDraftMaxLegNm', nauticalMiles })}
            min={MIN_MAX_LEG_NM}
            max={MAX_MAX_LEG_NM}
            step={1}
            disabled={!enabled}
            dense
          />
        </Fieldset>
      </Disclosure>
    </SectionBox>
  )
})
