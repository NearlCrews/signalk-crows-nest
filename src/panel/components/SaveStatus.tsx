/**
 * The save-state indicator shown next to the footer buttons. FooterBar owns
 * the permanently mounted live region and completion-focus target around it.
 * The host save callback is void, so the panel reports that a save was
 * requested without claiming persistence succeeded.
 */

import type * as React from 'react'
import { StatusIndicator } from 'signalk-nearlcrews-ui'

interface Props {
  dirty: boolean
  unconfigured: boolean
  /** Epoch milliseconds of the last save request, or null. */
  saveRequestedAt: number | null
}

/** The current save state, rendered as one stable status indicator. */
export default function SaveStatus ({ dirty, unconfigured, saveRequestedAt }: Props): React.ReactElement {
  if (dirty) return <StatusIndicator tone='warning'>Unsaved changes</StatusIndicator>
  if (saveRequestedAt !== null) {
    return <StatusIndicator tone='info'>Save requested</StatusIndicator>
  }
  if (unconfigured) return <StatusIndicator>Save to enable the plugin</StatusIndicator>
  return <StatusIndicator>No unsaved changes</StatusIndicator>
}
