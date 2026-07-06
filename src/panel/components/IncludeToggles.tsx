/**
 * The shared "import layers" checkbox grid used by the US-source cards.
 *
 * NOAA ENC, NOAA CO-OPS, and USACE each present the same thing: a titled
 * fieldset holding a grid of layer checkboxes, plus a warning shown only when
 * every box is off (the source is enabled but would import nothing). That
 * fieldset, the checkbox rows, and the empty-selection guard live here once so
 * the three cards cannot drift. A card that carries extra controls in the same
 * group (NOAA ENC's scale-band selector) passes them as `children`, rendered
 * above the grid; a card with a standing explanation (why a heavy layer
 * defaults off) passes it as `footnote`, rendered below the warning.
 */

import type * as React from 'react'
import { S } from '../styles.js'
import Fieldset from './Fieldset.js'

/** One checkbox in the include-toggles grid. */
export interface IncludeToggle {
  /** Stable id, used as the React key. */
  id: string
  /** The checkbox's visible label. */
  label: string
  /** Whether the checkbox is checked. */
  checked: boolean
  /** Called with the new checked state when the box is toggled. */
  onChange: (checked: boolean) => void
}

interface Props {
  /** The fieldset legend. */
  legend: string
  /** The checkboxes, in render order. */
  options: IncludeToggle[]
  /** Warning shown only when every option is off. */
  emptyWarning: string
  /** Optional controls rendered inside the fieldset, above the grid. */
  children?: React.ReactNode
  /** Optional standing note rendered below the warning. */
  footnote?: React.ReactNode
}

/** A titled group of import-layer checkboxes with the shared empty-selection warning. */
export default function IncludeToggles ({ legend, options, emptyWarning, children, footnote }: Props): React.ReactElement {
  const allOff = options.every((option) => !option.checked)
  return (
    <Fieldset title={legend}>
      {children}
      <div style={S.checkboxGrid}>
        {options.map((option) => (
          <label key={option.id} style={S.checkboxLabel}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={option.checked}
              onChange={(e) => option.onChange(e.target.checked)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {allOff && <p style={S.hint}>{emptyWarning}</p>}
      {footnote}
    </Fieldset>
  )
}
