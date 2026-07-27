/**
 * The OpenSeaMap seamark-group selector: a checklist of the four feature
 * groups the OpenSeaMap source can import. A note appears when nothing is
 * selected, because the source then has nothing to fetch.
 */

import type * as React from 'react'
import { Checkbox } from 'signalk-nearlcrews-ui'
import { SEAMARK_GROUP_REFS } from '../../shared/seamark-groups.js'
import { S } from '../styles.js'
import Fieldset from './Fieldset.js'
import SelectAllCheckbox from './SelectAllCheckbox.js'

interface Props {
  /** The currently selected seamark group ids. */
  selected: string[]
  /** Called when a group checkbox is toggled. */
  onToggle: (id: string, enabled: boolean) => void
  /** Called with the state every group should take (select-all control). */
  onSetAll: (enabled: boolean) => void
}

/** The seamark feature-group checkboxes shown in the OpenSeaMap card body. */
export default function SeamarkGroups ({ selected, onToggle, onSetAll }: Props): React.ReactElement {
  const selectedSet = new Set(selected)
  const selectedCount = SEAMARK_GROUP_REFS.filter((group) => selectedSet.has(group.id)).length
  return (
    <div style={S.groupsSection}>
      <Fieldset
        title='Feature groups to import'
        actions={
          <SelectAllCheckbox
            label='All groups'
            checkedCount={selectedCount}
            total={SEAMARK_GROUP_REFS.length}
            onSetAll={onSetAll}
          />
        }
      >
        <div style={S.checkboxGrid}>
          {SEAMARK_GROUP_REFS.map((group) => (
            <Checkbox
              key={group.id}
              label={group.label}
              checked={selectedSet.has(group.id)}
              onChange={(event) => onToggle(group.id, event.target.checked)}
            />
          ))}
        </div>
      </Fieldset>
      {selected.length === 0
        ? (
          <p style={S.hint}>
            No feature groups are selected, so the OpenSeaMap source imports
            nothing. Choose at least one group.
          </p>
          )
        : null}
    </div>
  )
}
