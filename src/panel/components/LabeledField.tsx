/**
 * Adapter for the shared UI label, control, and description scaffold used by
 * every labeled field on the panel.
 *
 * The control is supplied through a render prop that is passed straight to
 * the shared `LabeledField`, which owns id generation: it creates the control
 * id for the label's `htmlFor`, generates its own description id, hands both
 * to the render prop via `controlProps`, and renders the description with the
 * matching id, so the hint text is programmatically linked to the control and
 * a screen-reader user hears the constraint text, not just the label.
 */

import type * as React from 'react'
import { LabeledField as SharedLabeledField } from 'signalk-nearlcrews-ui'
import type { LabeledFieldControlProps } from 'signalk-nearlcrews-ui'

interface Props {
  /** Visible field label. */
  label: string
  /** Description linked to the control through aria-describedby. */
  hint: React.ReactNode
  /** Use the shared compact field density used below an alarm toggle. */
  dense?: boolean
  /** Render the control, spreading the given props onto it. */
  children: (controlProps: LabeledFieldControlProps) => React.ReactElement
}

/** A labeled shared UI field whose control comes from the render prop. */
export default function LabeledField ({ label, hint, dense, children }: Props): React.ReactElement {
  return (
    <SharedLabeledField
      label={label}
      description={hint}
      layout='inline'
      density={dense === true ? 'compact' : 'comfortable'}
    >
      {children}
    </SharedLabeledField>
  )
}
