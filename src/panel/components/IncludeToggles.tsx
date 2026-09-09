/**
 * The shared "import layers" checkbox group used by the US-source cards.
 *
 * NOAA ENC, NOAA CO-OPS, and USACE each present the same thing: a titled
 * group of layer checkboxes, plus a warning shown only when every box is off
 * (the source is enabled but would import nothing). The shared `CheckboxGroup`
 * renders the fieldset, the responsive grid, and the polite empty-selection
 * warning; this component maps the plugin's per-layer boolean flags onto the
 * group's value array so the three cards cannot drift. A card that carries an
 * extra control in the same group (NOAA ENC's scale-band selector) passes it
 * as `children`, rendered above the grid; a card with a standing explanation
 * (why a heavy layer defaults off) passes it as `description`, which the group
 * renders under its legend and links to the fieldset.
 */

import type * as React from 'react'
import { CheckboxGroup } from 'signalk-nearlcrews-ui/composites'
import { applySelectedValues, selectedValues, type ValueToggle } from '../checkbox-group-value.js'

interface Props {
  /** The fieldset legend. */
  legend: string
  /** The layer checkboxes, in render order. */
  options: ReadonlyArray<ValueToggle>
  /** Warning shown, and announced, only while every option is off. */
  emptyWarning: string
  /** Optional standing note rendered under the legend. */
  description?: React.ReactNode
  /** Optional controls rendered inside the group, above the grid. */
  children?: React.ReactNode
}

/** A titled group of import-layer checkboxes with the shared empty-selection warning. */
export default function IncludeToggles ({
  legend,
  options,
  emptyWarning,
  description,
  children
}: Props): React.ReactElement {
  return (
    <CheckboxGroup
      legend={legend}
      description={description}
      options={options}
      value={selectedValues(options)}
      onValueChange={(values) => applySelectedValues(options, values)}
      emptyWarning={emptyWarning}
    >
      {children}
    </CheckboxGroup>
  )
}
