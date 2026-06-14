/**
 * A bordered, collapsible container for one of the panel's top-level
 * sections (Data sources, Alerts).
 *
 * Each section is its own card: a clickable header carrying a real
 * `<h2>` (so screen-reader heading navigation can jump to it) plus a
 * disclosure chevron, plus a body that holds the section's children.
 * The outer `<section>` carries `aria-labelledby` referencing the
 * heading so the landmark has an accessible name. Sections collapse
 * independently. The Data sources section defaults open (the
 * operator's primary work area); the Alerts and Route drafting
 * sections default closed. Children stay mounted (visibility flips via
 * CSS) so an in-progress NumberField draft inside a child card
 * survives a collapse.
 *
 * `defaultExpanded` is read ONCE on mount (the standard `useState`
 * initial-value semantic), which is intentional: the prop sets the
 * initial state at first render and the user controls the section
 * thereafter.
 */

import type * as React from 'react'
import { useState } from 'react'
import { useCollapseFocusRestore } from '../hooks/use-collapse-focus-restore.js'
import { S } from '../styles.js'

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
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { bodyRef, buttonRef, restoreFocusBeforeCollapse } = useCollapseFocusRestore()
  const bodyId = `ac-section-body-${cardId}`
  const titleId = `ac-section-title-${cardId}`

  function handleToggle (): void {
    // Restore focus to the disclosure button before collapsing, so the
    // `display: none` flip does not strand a keyboard user on document.body.
    if (expanded) restoreFocusBeforeCollapse()
    setExpanded((open) => !open)
  }

  return (
    <section style={S.sectionBox} aria-labelledby={titleId}>
      <h2 style={S.sectionBoxHeading}>
        <button
          ref={buttonRef}
          type='button'
          style={S.sectionBoxHeader}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={handleToggle}
        >
          <span id={titleId} style={S.sectionBoxTitle}>{title}</span>
          <span style={S.sectionBoxChevron} aria-hidden='true'>{expanded ? '▾' : '▸'}</span>
        </button>
      </h2>
      <div
        ref={bodyRef}
        id={bodyId}
        style={expanded ? S.sectionBoxBody : S.collapsedBody}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        {children}
      </div>
    </section>
  )
}
