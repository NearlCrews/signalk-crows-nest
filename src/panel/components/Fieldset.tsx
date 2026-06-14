/**
 * Presentational shell for a titled fieldset: the standard `S.group` fieldset,
 * its legend, an optional hint paragraph, and a `children` slot for the field or
 * fields the group holds. This is the plain grouping shell with no toggle;
 * `ToggleFieldset` composes it and adds the opt-in checkbox row on top, so a
 * group that is a sub-section of one master toggle uses this directly rather
 * than showing a redundant checkbox of its own.
 */

import type * as React from 'react'
import { S } from '../styles.js'

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
    <fieldset style={S.group}>
      <legend style={S.groupTitle}>{title}{actions}</legend>
      {hint !== undefined && <p style={S.hint}>{hint}</p>}
      {children}
    </fieldset>
  )
}
