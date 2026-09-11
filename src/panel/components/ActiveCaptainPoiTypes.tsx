/**
 * The ActiveCaptain POI-type selector: the 13 toggles laid out in four labeled
 * groups, with a tri-state select-all checkbox over the whole set. A warning
 * appears when nothing is selected because chart notes stop while enabled
 * safety alerts continue to request the types they require.
 *
 * Each group is a shared `CheckboxGroup`; the outer `FieldGroup` carries the
 * select-all box in its legend row because the shared group's own select-all
 * covers one group, and here the operator selects across all four.
 */

import type * as React from 'react'
import { useId } from 'react'
import { Checkbox, FieldGroup, StatusIndicator } from 'signalk-nearlcrews-ui'
import { CheckboxGroup } from 'signalk-nearlcrews-ui/composites'
import { ACTIVE_CAPTAIN_POI_TYPE_GROUPS } from '../active-captain-poi-types.js'
import { applySelectedValues, selectedValues, type ValueToggle } from '../checkbox-group-value.js'
import { selectAllState, selectAllTarget } from '../select-all-state.js'
import type { PluginConfig, PoiTypeFlag } from '../../shared/types.js'

/** Shown, and announced, while no POI type is selected. */
const NOTHING_SELECTED_WARNING =
  'No POI types are selected, so no notes appear on the chart. ' +
  'Enabled safety alerts still fetch the hazard types they need.'

interface Props {
  config: PluginConfig
  onToggle: (flag: PoiTypeFlag, enabled: boolean) => void
  onSetAll: (enabled: boolean) => void
}

/** The grouped ActiveCaptain POI-type checkboxes shown in the configuration panel. */
export default function ActiveCaptainPoiTypes ({ config, onToggle, onSetAll }: Props): React.ReactElement {
  const groups = ACTIVE_CAPTAIN_POI_TYPE_GROUPS.map((group) => ({
    title: group.title,
    toggles: group.options.map((option): ValueToggle<PoiTypeFlag> => ({
      value: option.flag,
      label: option.label,
      checked: config[option.flag] === true,
      onChange: (checked) => onToggle(option.flag, checked)
    }))
  }))
  const totalCount = groups.reduce((count, group) => count + group.toggles.length, 0)
  const selectedCount = groups.reduce(
    (count, group) => count + selectedValues(group.toggles).length,
    0
  )
  const selectAll = selectAllState(selectedCount, totalCount)
  // The outer fieldset points at the warning while it shows, the way each
  // inner CheckboxGroup points at its own empty-selection warning. Without it
  // the only group whose warning was not part of its own description was the
  // one covering all four.
  const warningId = useId()
  // Named once: the description link and the warning body are the same
  // condition, and writing it twice lets them drift into pointing at an id
  // that renders nothing.
  const nothingSelected = selectedCount === 0

  // The whole selector lives inside one outer `Import layers` fieldset so
  // the ActiveCaptain card carries the same bordered "layers" container
  // every other source card uses (Feature groups for OpenSeaMap, Import
  // layers for NOAA ENC). The four group fieldsets sit inside it.
  return (
    <FieldGroup
      legend='Import layers'
      aria-describedby={nothingSelected ? warningId : undefined}
      actions={
        <Checkbox
          label='All types'
          checked={selectAll.checked}
          indeterminate={selectAll.indeterminate}
          onChange={() => onSetAll(selectAllTarget(selectedCount, totalCount))}
        />
      }
    >
      {groups.map((group) => (
        <CheckboxGroup
          key={group.title}
          legend={group.title}
          options={group.toggles}
          value={selectedValues(group.toggles)}
          onValueChange={(values) => applySelectedValues(group.toggles, values)}
        />
      ))}
      {/* One announcing indicator, mounted before the warning arrives so the
          announcement is not lost. It renders empty, and takes up no space,
          while a type is selected. */}
      <StatusIndicator id={warningId} tone='warning' live='polite'>
        {nothingSelected ? NOTHING_SELECTED_WARNING : null}
      </StatusIndicator>
    </FieldGroup>
  )
}
