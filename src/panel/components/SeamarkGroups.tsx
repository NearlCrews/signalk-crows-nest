/**
 * The OpenSeaMap seamark-group selector: a checklist of the four feature
 * groups the OpenSeaMap source can import, with a select-all box and a
 * warning when nothing is selected, because the source then has nothing to
 * fetch. The shared `CheckboxGroup` reports the selection in option order,
 * which is the canonical group order, so toggling a group off and on again
 * never reshuffles the stored list.
 */

import type * as React from 'react'
import { CheckboxGroup } from 'signalk-nearlcrews-ui/composites'
import { SEAMARK_GROUP_REFS } from '../../shared/seamark-groups.js'

/** Hoisted so the option list is not rebuilt on every render. */
const OPTIONS = SEAMARK_GROUP_REFS.map((group) => ({ value: group.id, label: group.label }))

interface Props {
  /** The currently selected seamark group ids. */
  selected: string[]
  /** Called with the new selection, in canonical group order. */
  onChange: (groups: string[]) => void
}

/** The seamark feature-group checkboxes shown in the OpenSeaMap card body. */
export default function SeamarkGroups ({ selected, onChange }: Props): React.ReactElement {
  return (
    <CheckboxGroup<string>
      legend='Feature groups to import'
      options={OPTIONS}
      value={selected}
      onValueChange={(values) => onChange([...values])}
      selectAllLabel='All groups'
      emptyWarning='No feature groups are selected, so the OpenSeaMap source imports nothing. Choose at least one group.'
    />
  )
}
