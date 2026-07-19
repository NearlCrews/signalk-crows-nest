/**
 * Adapter for the shared UI label, control, and description scaffold used by
 * every labeled field on the panel.
 *
 * The control is supplied through a render prop that receives the `id` (for
 * the label's `htmlFor`) and an `aria-describedby` pointing at the hint
 * description, so the hint text is programmatically linked to the control and a
 * screen-reader user hears the constraint text, not just the label. Building
 * the wiring into the scaffold makes the link impossible to forget in a new
 * field.
 */

import type * as React from 'react'
import { LabeledField as SharedLabeledField } from 'signalk-nearlcrews-ui'

/** The props the render prop must spread onto its control element. */
interface LabeledControlProps {
  id: string
  'aria-describedby'?: string
}

interface Props {
  /** Stable id linking the visible label to the control. */
  id: string
  /** Visible field label. */
  label: string
  /** Description linked to the control through aria-describedby. */
  hint: React.ReactNode
  /** Use the shared compact field density used below an alarm toggle. */
  dense?: boolean
  /** Render the control, spreading the given props onto it. */
  children: (controlProps: LabeledControlProps) => React.ReactElement
}

/** A labeled shared UI field whose control comes from the render prop. */
export default function LabeledField ({ id, label, hint, dense, children }: Props): React.ReactElement {
  const control = children({ id })
  return (
    <SharedLabeledField
      label={label}
      description={hint}
      layout='inline'
      density={dense === true ? 'compact' : 'comfortable'}
    >
      {control}
    </SharedLabeledField>
  )
}
