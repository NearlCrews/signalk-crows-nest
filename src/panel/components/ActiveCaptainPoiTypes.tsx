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
import { Checkbox, FieldGroup, StatusIndicator } from 'signalk-nearlcrews-ui'
import { CheckboxGroup } from 'signalk-nearlcrews-ui/composites'
import { ACTIVE_CAPTAIN_POI_TYPE_GROUPS } from '../active-captain-poi-types.js'
import { applySelectedValues, selectedValues, type ValueToggle } from '../checkbox-group-value.js'
import { selectAllState, selectAllTarget } from '../select-all-state.js'
import type { PluginConfig, PoiTypeFlag } from '../../shared/types.js'

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

  // The whole selector lives inside one outer `Import layers` fieldset so
  // the ActiveCaptain card carries the same bordered "layers" container
  // every other source card uses (Feature groups for OpenSeaMap, Import
  // layers for NOAA ENC). The four group fieldsets sit inside it.
  return (
    <FieldGroup
      legend='Import layers'
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
      {/* The region is mounted before the warning arrives so the announcement
          is not lost; the role alone makes it live, per the shared rule. */}
      <div role='status'>
        {selectedCount === 0
          ? (
            <StatusIndicator tone='warning'>
              No POI types are selected, so no notes appear on the chart. Enabled
              safety alerts still fetch the hazard types they need.
            </StatusIndicator>
            )
          : null}
      </div>
    </FieldGroup>
  )
}
