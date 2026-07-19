/**
 * The ActiveCaptain POI-type selector: the 13 toggles laid out in four labeled
 * groups, with All and None bulk buttons. A note appears when nothing is
 * selected because chart notes stop while enabled safety alerts continue to
 * request the types they require.
 */

import type * as React from 'react'
import { Button, Checkbox, FieldGroup } from 'signalk-nearlcrews-ui'
import { ACTIVE_CAPTAIN_POI_TYPE_GROUPS } from '../active-captain-poi-types.js'
import type { PluginConfig, PoiTypeFlag } from '../../shared/types.js'
import { S } from '../styles.js'
import Fieldset from './Fieldset.js'

interface Props {
  config: PluginConfig
  onToggle: (flag: PoiTypeFlag, enabled: boolean) => void
  onSetAll: (enabled: boolean) => void
}

/** The grouped ActiveCaptain POI-type checkboxes shown in the configuration panel. */
export default function ActiveCaptainPoiTypes ({ config, onToggle, onSetAll }: Props): React.ReactElement {
  const anySelected = ACTIVE_CAPTAIN_POI_TYPE_GROUPS.some(
    (group) => group.options.some((option) => config[option.flag] === true)
  )

  // The whole selector lives inside one outer `Import layers` fieldset so
  // the ActiveCaptain card carries the same bordered "layers" container
  // every other source card uses (Seamark groups for OpenSeaMap, Hazard
  // layers for NOAA ENC). The four sub-group fieldsets sit inside it.
  return (
    <Fieldset
      title='Import layers'
      actions={
        <span style={S.bulkButtons}>
          <Button size='compact' shape='pill' onClick={() => onSetAll(true)}>All</Button>
          <Button size='compact' shape='pill' onClick={() => onSetAll(false)}>None</Button>
        </span>
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
