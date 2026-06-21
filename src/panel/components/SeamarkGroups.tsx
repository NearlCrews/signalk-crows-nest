/**
 * The OpenSeaMap seamark-group selector: a checklist of the four feature
 * groups the OpenSeaMap source can import. A note appears when nothing is
 * selected, because the source then has nothing to fetch.
 */

import type * as React from 'react'
import { SEAMARK_GROUP_REFS } from '../../shared/seamark-groups.js'
import { S } from '../styles.js'
import Fieldset from './Fieldset.js'

interface Props {
  /** The currently selected seamark group ids. */
  selected: string[]
  /** Called when a group checkbox is toggled. */
  onToggle: (id: string, enabled: boolean) => void
}

/** The seamark feature-group checkboxes shown in the OpenSeaMap card body. */
export default function SeamarkGroups ({ selected, onToggle }: Props): React.ReactElement {
  const selectedSet = new Set(selected)
  return (
    <div style={S.groupsSection}>
      <Fieldset title='Feature groups to import'>
        <div style={S.checkboxGrid}>
          {SEAMARK_GROUP_REFS.map((group) => (
            <label key={group.id} style={S.checkboxLabel}>
              <input
                type='checkbox'
                style={S.checkbox}
                checked={selectedSet.has(group.id)}
                onChange={(e) => onToggle(group.id, e.target.checked)}
              />
              {group.label}
            </label>
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
