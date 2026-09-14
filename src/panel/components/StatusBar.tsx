/**
 * Plugin status section at the top of the panel: one row per enabled POI
 * source (name, reachability, and the relative time of the last list fetch),
 * plus any recent errors. Driven entirely by the StatusSnapshot polled from
 * the plugin.
 *
 * The section reports source HEALTH, not the count returned by the most
 * recent list call. The count is just "what fell inside the chartplotter's
 * last bounding-box query" and is meaningless until the chart is panned, so
 * showing it here reads as misleading.
 *
 * The section is a passive readout, not a live region: the relative ages tick
 * every few seconds, and the error list holds up to `MAX_RECENT_ERRORS`
 * entries, so announcing the section on each change would read the whole
 * thing out for a changed age. The panel announces through the components that own a single
 * message instead: the save bar, the status banner below this section, and
 * each checkbox group's empty-selection warning.
 */

import type * as React from 'react'
import { memo, useRef, type RefObject } from 'react'
import {
  Banner,
  Button,
  Cluster,
  RelativeAge,
  Section,
  Stack,
  StatusIndicator,
  Text,
  type StatusTone
} from 'signalk-nearlcrews-ui'
import { Table, TableCell, TableHeaderCell } from 'signalk-nearlcrews-ui/composites'
import { sourceDisplayName } from '../source-names.js'
import type { SourceStatus, StatusError, StatusSnapshot } from '../../status/status-types.js'

/**
 * Map the tri-state apiReachable flag to a status tone and label. Each label
 * is capitalized and names the source's state rather than its severity: the
 * tone already contributes "Success" or "Error" to the accessible name, so a
 * label that repeated it would read as a stutter.
 */
function apiState (reachable: boolean | null): { tone: StatusTone, label: string } {
  if (reachable === true) return { tone: 'success', label: 'Reachable' }
  if (reachable === false) return { tone: 'danger', label: 'Unreachable' }
  return { tone: 'neutral', label: 'Not yet contacted' }
}

/**
 * The per-source health table. Two columns keep it inside a 320 pixel panel
 * without a scroll region: the source name is the row header, and the status
 * cell stacks the reachability indicator over the last-fetch age.
 */
function SourceTable ({ sources }: { sources: SourceStatus[] }): React.ReactElement {
  return (
    <Table caption='Data source health' captionVisibility='hidden' density='compact'>
      <thead>
        <tr>
          <TableHeaderCell>Source</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => {
          const api = apiState(source.apiReachable)
          return (
            <tr key={source.source}>
              <TableHeaderCell scope='row'>{source.name}</TableHeaderCell>
              <TableCell>
                <StatusIndicator tone={api.tone}>{api.label}</StatusIndicator>
                <Text as='div' tone='muted' size='sm'>
                  {source.lastListFetch === null
                    ? 'no fetch yet'
                    : <>updated <RelativeAge since={source.lastListFetch.at} /></>}
                </Text>
              </TableCell>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

interface RecentErrorsProps {
  errors: StatusError[]
  sources: SourceStatus[]
  onJumpToSource: ((slug: string) => void) | undefined
  /** Where focus lands if the banner goes while the operator is standing in it. */
  focusFallbackRef: RefObject<HTMLHeadingElement | null>
}

/**
 * The recent-error list. An error recorded against a known source gets a
 * button that expands and scrolls to that source's card, named after the
 * source so one identical "Show source" button per source never reaches a
 * screen reader's button list.
 *
 * The banner carries those buttons, so a poll that clears the errors while
 * one of them has focus would otherwise take the focused control away and
 * drop the reader on the body. `dismissFocusRef` catches that: the section
 * heading is the destination, so the reader is told where it landed.
 *
 * Known gap: no browser test covers that handoff. The fixture serves one
 * status payload for the life of the page, so driving a mid-session clear
 * would need a fixture mode of its own plus `page.clock` to reach the next
 * poll, and a timing-driven test written against a release branch is how a
 * flaky one gets in. The trigger is narrow (the plugin's error list is a
 * bounded ring that clears only on a restart), so the gap was left open
 * deliberately rather than overlooked.
 */
function RecentErrors (
  { errors, sources, onJumpToSource, focusFallbackRef }: RecentErrorsProps
): React.ReactElement {
  // The snapshot is the authority where it has a row, and it does not always
  // have one: plugin-status.ts records an error against a source that failed
  // before it registered, which used to leave the button reading "Show
  // openseamap". The panel's own names answer for those.
  const nameBySlug = new Map(sources.map((source) => [source.source, source.name]))
  return (
    <Banner tone='danger' title='Recent errors' dismissFocusRef={focusFallbackRef}>
      {/* A list Stack wraps each child in its own list item. */}
      <Stack as='ul' gap={2}>
        {errors.map(({ at, message, source }, index) => (
          <Cluster key={`${at}-${source ?? ''}-${message}-${index}`} gap={2}>
            <Text tone='muted' size='sm'><RelativeAge since={at} /></Text>
            <span>{message}</span>
            {source !== undefined && onJumpToSource !== undefined
              ? (
                <Button onClick={() => onJumpToSource(source)}>
                  Show {sourceDisplayName(source, nameBySlug.get(source))}
                </Button>
                )
              : null}
          </Cluster>
        ))}
      </Stack>
    </Banner>
  )
}

interface Props {
  status: StatusSnapshot | null
  /**
   * Epoch milliseconds of the most recent successful status poll, or null.
   * Renders as a "checked N ago" note so the operator can tell a live
   * readout from a stalled one.
   */
  lastUpdatedMs: number | null
  /**
   * Expand and scroll to the source card an error belongs to. When given,
   * a recent error recorded against a known source renders a jump button.
   */
  onJumpToSource?: (slug: string) => void
}

/**
 * The status section shown at the top of the configuration panel. Memoized:
 * the `status` prop is referentially stable between polls and `lastUpdatedMs`
 * changes only on the 5 s poll tick, so a keystroke elsewhere on the panel
 * does not re-render the table. The relative ages own their own clocks.
 */
export default memo(function StatusBar ({ status, lastUpdatedMs, onJumpToSource }: Props): React.ReactElement {
  // Focus destination for the recent-error banner. `headingRef` is the shared
  // Section's own answer for this: it makes the heading programmatically
  // focusable and nothing more, so it adds no tab stop, and a screen reader
  // landing on it reads "Plugin status", which says where the errors went.
  const headingRef = useRef<HTMLHeadingElement>(null)
  return (
    <Section
      headingRef={headingRef}
      title='Plugin status'
      actions={lastUpdatedMs !== null
        ? <Text tone='muted' size='sm'>Checked <RelativeAge since={lastUpdatedMs} /></Text>
        : undefined}
    >
      {/*
        Prose rather than the shared EmptyState. This is one sentence inside a
        section that already carries a heading and a freshness note, not a
        blank page, so the component's title, description, icon, and action
        layout would overstate it. It is also the only thing that would pull
        EmptyState and its style module into a bundle that currently drops
        both.
      */}
      {status === null
        ? <StatusIndicator tone='neutral'>Loading status...</StatusIndicator>
        : status.sources.length === 0
          ? (
            <Text as='p' tone='muted'>
              No data source enabled yet. Open a card below and toggle one on.
            </Text>
            )
          : <SourceTable sources={status.sources} />}
      {status !== null && status.recentErrors.length > 0
        ? (
          <RecentErrors
            errors={status.recentErrors}
            sources={status.sources}
            onJumpToSource={onJumpToSource}
            focusFallbackRef={headingRef}
          />
          )
        : null}
    </Section>
  )
})
