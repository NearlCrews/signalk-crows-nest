/**
 * A controlled numeric field: a label, a number input backed by
 * `useNumberDraft` (so the field can be cleared mid-edit), and a paragraph of
 * hint text. Every numeric setting on the panel uses this so the draft-commit
 * dance does not have to be re-implemented in each component.
 *
 * Pass `dense` for the shared compact layout used inside an alarm fieldset,
 * where the field sits below a toggle rather than at the top of a section.
 */

import type * as React from 'react'
import { NumberInput } from 'signalk-nearlcrews-ui'
import { useNumberDraft } from '../hooks/use-number-draft.js'
import type { NumberDraftOptions } from '../hooks/use-number-draft.js'
import LabeledField from './LabeledField.js'

interface Props extends NumberDraftOptions {
  /** Stable id linking the visible label to the input. */
  id: string
  /** Visible field label. */
  label: string
  /** Hint paragraph rendered next to the input. */
  hint: React.ReactNode
  /** Committed value. */
  value: number
  /** Called with the clamped value on every keystroke. */
  onChange: (next: number) => void
  /** Disable the input. */
  disabled?: boolean
  /** Numeric step the up/down arrows use. */
  step?: number
  /** Use the tighter labelled-input row layout used below an alarm toggle. */
  dense?: boolean
}

/** A label + number input + hint row, with a draft-while-editing buffer. */
export default function NumberField ({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  step,
  dense,
  min,
  max,
  integer,
  fallback
}: Props): React.ReactElement {
  const draft = useNumberDraft(value, onChange, { min, max, integer, fallback })

  return (
    <LabeledField id={id} label={label} hint={hint} dense={dense}>
      {(controlProps) => (
        <NumberInput
          {...controlProps}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={draft.display}
          onChange={(e) => draft.handleChange(e.target.value)}
          onBlur={draft.handleBlur}
        />
      )}
    </LabeledField>
  )
}
