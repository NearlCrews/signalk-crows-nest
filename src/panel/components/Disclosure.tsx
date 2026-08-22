/**
 * A collapsible "Advanced" disclosure, built on the shared UI package's
 * `CollapsibleSection`. That component owns the heading button, the named
 * region, keyboard toggling, and focus restore when focused content closes.
 * `mountStrategy='retain'` keeps the children mounted while collapsed, so an
 * in-progress field draft survives a collapse-and-expand round trip exactly as
 * the data-source cards already do. Used to tuck rarely-changed tuning out of
 * a card's default view.
 */

import type * as React from 'react'
import { CollapsibleSection } from 'signalk-nearlcrews-ui'

interface Props {
  /** The always-visible summary label. Defaults to "Advanced", the only label in use. */
  summary?: string
  /** The controls revealed when the disclosure is open. */
  children: React.ReactNode
}

/** An accessible collapsible section for advanced or rarely-used controls. */
export default function Disclosure ({ summary = 'Advanced', children }: Props): React.ReactElement {
  return (
    <CollapsibleSection title={summary} mountStrategy='retain'>
      {children}
    </CollapsibleSection>
  )
}
