/**
 * The Advanced disclosure every data-source card puts its tuning fields in.
 * Each card differs only in which field groups it holds, so the shell lives
 * here: one heading level, one landmark decision, and one gap between groups.
 */

import type * as React from 'react'
import type { ReactNode } from 'react'
import { CollapsibleSection, Stack } from 'signalk-nearlcrews-ui'

interface Props {
  children: ReactNode
}

/** Wraps a source card's tuning fields in the shared Advanced section. */
export default function SourceAdvanced ({ children }: Props): React.ReactElement {
  return (
    <CollapsibleSection title='Advanced' headingLevel={4} landmark={false}>
      <Stack gap={3}>{children}</Stack>
    </CollapsibleSection>
  )
}
