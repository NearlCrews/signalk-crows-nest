/**
 * The dirty / just-saved indicator shown next to the footer buttons. The
 * "Saved" pill is the panel's one polite live region (`role='status'`), so a
 * screen-reader user hears the confirmation without the rest of the panel
 * announcing itself.
 */

import type * as React from 'react'
import { StatusIndicator } from 'signalk-nearlcrews-ui'

interface Props {
  dirty: boolean
  /** Epoch milliseconds of the last successful save, or null. Drives the "Saved" pill. */
  justSavedAt: number | null
}

/** The save-state indicator: "Unsaved changes", a "Saved" pill, or nothing. */
export default function SaveStatus ({ dirty, justSavedAt }: Props): React.ReactElement | null {
  if (dirty) return <StatusIndicator>Unsaved changes</StatusIndicator>
  if (justSavedAt !== null) return <StatusIndicator role='status' tone='success'>Saved</StatusIndicator>
  return null
}
