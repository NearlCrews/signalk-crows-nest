/**
 * The dirty / just-saved indicator shown next to the footer buttons. The
 * "Saved" pill is the panel's one polite live region (`role='status'`), so a
 * screen-reader user hears the confirmation without the rest of the panel
 * announcing itself.
 *
 * The live region stays permanently mounted and only its CONTENT changes.
 * Rendering the Saved pill conditionally with `role='status'` on the pill
 * itself let React reconcile the dirty and saved indicators into one span, so
 * the role arrived in the same commit as the "Saved" text, and a live region
 * that gains its role together with its content is commonly not announced.
 * The dirty indicator deliberately sits outside the region: every keystroke
 * flips it, and announcing that would be noise.
 */

import type * as React from 'react'
import { StatusIndicator } from 'signalk-nearlcrews-ui'

interface Props {
  dirty: boolean
  /** Epoch milliseconds of the last successful save, or null. Drives the "Saved" pill. */
  justSavedAt: number | null
}

/** The save-state indicator: "Unsaved changes" plus the "Saved" live region. */
export default function SaveStatus ({ dirty, justSavedAt }: Props): React.ReactElement {
  return (
    <>
      {dirty ? <StatusIndicator>Unsaved changes</StatusIndicator> : null}
      <span role='status'>
        {!dirty && justSavedAt !== null
          ? <StatusIndicator tone='success'>Saved</StatusIndicator>
          : null}
      </span>
    </>
  )
}
