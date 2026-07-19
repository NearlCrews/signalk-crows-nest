/**
 * Adapter for the shared UI field group with Crow's Nest's existing title and
 * hint prop names. This is the plain grouping shell with no toggle;
 * `ToggleFieldset` composes it and adds the opt-in checkbox row on top, so a
 * group that is a sub-section of one master toggle uses this directly rather
 * than showing a redundant checkbox of its own.
 */

import type * as React from 'react'
import { FieldGroup } from 'signalk-nearlcrews-ui'

interface Props {
  /** Fieldset legend, the group name. */
  title: string
  /** Optional controls rendered beside the legend title, e.g. bulk All/None buttons. */
  actions?: React.ReactNode
  /** Optional hint paragraph rendered below the legend. */
  hint?: React.ReactNode
  /** The field or fields the group holds. */
  children: React.ReactNode
}

/** A titled fieldset shell with an optional legend action slot, an optional hint, and a children slot. */
export default function Fieldset ({ title, actions, hint, children }: Props): React.ReactElement {
  return (
    <FieldGroup legend={title} actions={actions} description={hint}>
      {children}
    </FieldGroup>
  )
}
