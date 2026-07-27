/**
 * The ActiveCaptain POI-type selector: the 13 toggles laid out in four labeled
 * groups, with a tri-state select-all checkbox. A note appears when nothing is
 * selected because chart notes stop while enabled safety alerts continue to
 * request the types they require.
 */

import type * as React from 'react'
import { Checkbox, FieldGroup } from 'signalk-nearlcrews-ui'
import { ACTIVE_CAPTAIN_POI_TYPE_GROUPS } from '../active-captain-poi-types.js'
import type { PluginConfig, PoiTypeFlag } from '../../shared/types.js'
import { S } from '../styles.js'
import Fieldset from './Fieldset.js'
import SelectAllCheckbox from './SelectAllCheckbox.js'

interface Props {
  config: PluginConfig
  onToggle: (flag: PoiTypeFlag, enabled: boolean) => void
  onSetAll: (enabled: boolean) => void
}

/** The grouped ActiveCaptain POI-type checkboxes shown in the configuration panel. */
export default function ActiveCaptainPoiTypes ({ config, onToggle, onSetAll }: Props): React.ReactElement {
  const totalCount = ACTIVE_CAPTAIN_POI_TYPE_GROUPS.reduce(
    (count, group) => count + group.options.length, 0
  )
  const selectedCount = ACTIVE_CAPTAIN_POI_TYPE_GROUPS.reduce(
    (count, group) =>
      count + group.options.filter((option) => config[option.flag] === true).length,
    0
  )
  const anySelected = selectedCount > 0

  // The whole selector lives inside one outer `Import layers` fieldset so
  // the ActiveCaptain card carries the same bordered "layers" container
  // every other source card uses (Seamark groups for OpenSeaMap, Hazard
  // layers for NOAA ENC). The four sub-group fieldsets sit inside it.
  return (
    <Fieldset
      title='Import layers'
      actions={
        <SelectAllCheckbox
          label='All types'
          checkedCount={selectedCount}
          total={totalCount}
          onSetAll={onSetAll}
        />
      }
    >
      {ACTIVE_CAPTAIN_POI_TYPE_GROUPS.map((group) => (
        <FieldGroup key={group.title} legend={group.title}>
          <div style={S.checkboxGrid}>
            {group.options.map((option) => (
              <Checkbox
                key={option.flag}
                label={option.label}
                checked={config[option.flag] === true}
                onChange={(event) => onToggle(option.flag, event.target.checked)}
              />
            ))}
          </div>
        </FieldGroup>
      ))}
      {anySelected
        ? null
        : (
          <p style={S.hint}>
            No POI types are selected, so no notes appear on the chart. Enabled
            safety alerts still fetch the hazard types they need.
          </p>
          )}
    </Fieldset>
  )
}
