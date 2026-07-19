/**
 * Adapter for the shared UI collapsible section used by the panel's top-level
 * Data sources and Alerts sections.
 *
 * Sections collapse independently. The Data sources section defaults open (the
 * operator's primary work area); the Alerts section defaults
 * closed. Children stay mounted so an in-progress NumberField draft inside a child card
 * survives a collapse.
 *
 * `defaultExpanded` is read ONCE on mount (the standard `useState`
 * initial-value semantic), which is intentional: the prop sets the
 * initial state at first render and the user controls the section
 * thereafter.
 */

import type * as React from 'react'
import { CollapsibleSection } from 'signalk-nearlcrews-ui'

interface Props {
  /** Stable id used as the body region id for aria-controls / aria-labelledby. */
  cardId: string
  /** Visible title shown in the header (e.g. "Data sources"). */
  title: string
  /**
   * Whether the section is expanded on first render. Read once on
   * mount; subsequent changes to this prop do not re-open or
   * re-collapse the section.
   */
  defaultExpanded?: boolean
  /** The section's contents. */
  children: React.ReactNode
}

/** Bordered card with a clickable disclosure header for a panel section. */
export default function SectionBox ({
  cardId,
  title,
  defaultExpanded = true,
  children
}: Props): React.ReactElement {
  return (
    <CollapsibleSection
      id={`ac-section-${cardId}`}
      title={title}
      defaultOpen={defaultExpanded}
      mountStrategy='retain'
    >
      {children}
    </CollapsibleSection>
  )
}
