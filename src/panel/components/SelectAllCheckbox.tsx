/**
 * A tri-state select-all checkbox for a group of toggles: checked when every
 * toggle is on, indeterminate when only some are, unchecked when none are.
 * Clicking completes the selection unless the group is already fully
 * selected, in which case it clears it. Used in a fieldset's actions slot by
 * the ActiveCaptain POI-type selector and the OpenSeaMap seamark groups.
 */

import type * as React from 'react'
import { Checkbox } from 'signalk-nearlcrews-ui'
import { selectAllState, selectAllTarget } from '../select-all-state.js'

interface Props {
  /** The checkbox's visible label, e.g. `All types`. */
  label: string
  /** How many of the group's toggles are currently on. */
  checkedCount: number
  /** How many toggles the group has. */
  total: number
  /** Called with the state every toggle in the group should take. */
  onSetAll: (enabled: boolean) => void
}

/** The tri-state select-all control rendered beside a toggle-group legend. */
export default function SelectAllCheckbox ({ label, checkedCount, total, onSetAll }: Props): React.ReactElement {
  const { checked, indeterminate } = selectAllState(checkedCount, total)
  return (
    <Checkbox
      label={label}
      checked={checked}
      indeterminate={indeterminate}
      onChange={() => onSetAll(selectAllTarget(checkedCount, total))}
    />
  )
}
