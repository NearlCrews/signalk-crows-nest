/**
 * A collapsible data-source card for the configuration panel's accordion,
 * built on the shared `CollapsibleSection`. The header carries an enable
 * checkbox (or an "Always on" badge for a source with no enable toggle) in the
 * leading slot, the source name as an h3, a one-line summary while collapsed,
 * and an optional live-status pill in the actions slot. The shared section
 * owns the heading button, `aria-expanded`, the named content region, focus
 * restore on collapse, and the retained subtree that keeps a half-typed
 * numeric draft alive across a collapse and re-expand.
 *
 * Disclosure state lives on the panel root and is threaded down through
 * `expanded` + `onToggleExpanded(cardId, open)`. Keeping the state outside the
 * card lets it survive any future subtree remount, lets the panel persist it
 * across saves if it ever wants to, and lets the panel iterate cards with a
 * stable map of slug to expanded-flag.
 *
 * The card surfaces "Disabled" inline in the summary when the enable toggle
 * is off, so a collapsed disabled row reads as off at a glance and not just
 * as a configured-but-unchecked source. An always-on source (one with no
 * enable toggle) omits `onToggleEnabled`; the header shows an "Always on"
 * badge instead of a checkbox so it cannot be mistaken for a disabled toggle.
 *
 * The status pill sits in the actions slot, outside the toggle button: a
 * touch user tapping the pill must not toggle the card, and a screen reader
 * walking the header must not absorb the pill's status text into the button's
 * accessible name. The pill's longer explanation ("17 POIs in last fetch, 5
 * minutes ago") is visible text at the top of the expanded card rather than a
 * tooltip, so keyboard and touch users can reach it.
 *
 * The cards are not region landmarks: a nested region per source inside the
 * Data sources region would crowd a screen reader's landmark list, and the h3
 * headings already give heading navigation one stop per source.
 */

import type * as React from 'react'
import {
  Badge,
  Checkbox,
  CollapsibleSection,
  RelativeAge,
  Stack,
  Text,
  type StatusTone
} from 'signalk-nearlcrews-ui'
import { pillContent, pillVariant, type PillVariant } from '../source-status-pill.js'
import { SOURCE_NAMES } from '../source-names.js'
import type { SourceSlug } from '../../shared/source-ids.js'
import type { SourceStatus } from '../../status/status-types.js'

/** The badge tone for each pill variant; the label carries the meaning too. */
const PILL_TONE: Record<PillVariant, StatusTone> = {
  error: 'danger',
  waiting: 'warning',
  idle: 'neutral',
  ok: 'success'
}

interface Props {
  /**
   * Stable id used as the disclosure-state key, e.g. `'activecaptain'`.
   * Mirrors the source's PoiSource.id so the same string keys the panel's
   * expandedCards map AND looks up the source's StatusSnapshot entry.
   */
  cardId: SourceSlug
  /** Whether the source is enabled. */
  enabled: boolean
  /** One-line summary of the source's settings, shown collapsed. */
  summary: string
  /** Whether the card is currently expanded. */
  expanded: boolean
  /** Record the card's new open state; receives the cardId. */
  onToggleExpanded: (cardId: SourceSlug, open: boolean) => void
  /**
   * Called when the enable checkbox is toggled. Omitted for an always-on
   * source; the header then shows an "Always on" badge in place of the
   * checkbox rather than a disabled checkbox.
   */
  onToggleEnabled?: (enabled: boolean) => void
  /**
   * Per-source status snapshot. When present, the card header surfaces a
   * compact pill reporting the last list-fetch outcome (idle / waiting / ok /
   * error). The pill renders regardless of enabled state because a
   * recently-disabled source can still carry meaningful last-fetch state
   * for an operator triaging the panel.
   */
  status?: SourceStatus
  /** The source's configuration fields. */
  children: React.ReactNode
}

/** A collapsible card for one POI data source. */
export default function DataSourceCard ({
  cardId,
  enabled,
  summary,
  expanded,
  onToggleExpanded,
  onToggleEnabled,
  status,
  children
}: Props): React.ReactElement {
  // The slug already determines the name, so the card looks it up rather than
  // taking a second prop that a new card could get out of step with it.
  const name = SOURCE_NAMES[cardId]
  // Prefix the summary with "Disabled" when the enable toggle is off, so
  // a collapsed disabled card never reads as if it were live (the small
  // unchecked checkbox alone is too subtle a signal).
  const summaryText = enabled ? summary : `Disabled. ${summary}`
  const variant = status === undefined ? undefined : pillVariant(status)
  const pill = status === undefined || variant === undefined ? undefined : pillContent(status, variant)
  return (
    <CollapsibleSection
      id={sourceCardDomId(cardId)}
      title={name}
      headingLevel={3}
      landmark={false}
      open={expanded}
      onOpenChange={(open) => onToggleExpanded(cardId, open)}
      leading={onToggleEnabled !== undefined
        ? (
          <Checkbox
            label={`Enable ${name}`}
            labelVisibility='hidden'
            checked={enabled}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
          )
        : (
          // An always-on source shows a non-interactive "Always on" badge
          // rather than a disabled checkbox: a disabled checkbox is
          // visually indistinguishable from an off-and-greyed-out toggle,
          // so an operator might think the source is unavailable.
          <Badge tone='neutral'>Always on</Badge>
          )}
      summary={summaryText}
      summaryPlacement='header'
      actions={pill !== undefined && variant !== undefined
        ? <Badge tone={PILL_TONE[variant]}>{pill.label}</Badge>
        : undefined}
    >
      <Stack gap={3}>
        {pill !== undefined
          ? (
            <Text as='p' tone='muted' size='sm'>
              {pill.detail}
              {pill.since !== undefined ? <>, <RelativeAge since={pill.since} /></> : null}.
            </Text>
            )
          : null}
        {children}
      </Stack>
    </CollapsibleSection>
  )
}

/**
 * Stable DOM id of a source card's outer element, so the jump-to-error
 * shortcut can find the offending card without a ref through the accordion.
 */
export function sourceCardDomId (cardId: string): string {
  return `ac-source-card-${cardId}`
}

/**
 * Bring a source card that has just been expanded into view, and hand focus
 * to it.
 *
 * Focus goes to the card's own disclosure toggle. That names the source and
 * reports the card as expanded, so a screen reader announces the destination
 * instead of the operator being silently scrolled, and it leaves the next Tab
 * on the card's first field rather than on the rest of the error list. It is
 * also where the shared section returns focus when the card is collapsed
 * again, so a jump and a collapse agree on where the card's handle is.
 *
 * The toggle is the button inside the card's own h3: `headingLevel={3}` above
 * is what makes that unambiguous, because the Advanced disclosure nested in
 * the body is an h4. Focus runs first with `preventScroll` so the browser's
 * instant focus scroll does not cancel the smooth scroll that follows.
 */
export function revealSourceCard (cardId: string): void {
  const card = document.getElementById(sourceCardDomId(cardId))
  if (card === null) return
  card.querySelector<HTMLElement>('h3 button')?.focus({ preventScroll: true })
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
}

// pillVariant + pillContent are in `../source-status-pill.ts` so the
// unit tests can import them without bringing in JSX.
