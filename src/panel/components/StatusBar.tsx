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
 * The section is a passive readout, not a live region: the relative ages
 * tick every few seconds, so announcing the whole section on each change
 * would be pure noise. The save bar remains the panel's one polite live
 * region, which is the right number.
 */

import type * as React from 'react'
import { memo } from 'react'
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
import type { SourceStatus, StatusError, StatusSnapshot } from '../../status/status-types.js'

/** Map the tri-state apiReachable flag to a status tone and label. */
function apiState (reachable: boolean | null): { tone: StatusTone, label: string } {
  if (reachable === true) return { tone: 'success', label: 'reachable' }
  if (reachable === false) return { tone: 'danger', label: 'unreachable' }
  return { tone: 'neutral', label: 'not yet contacted' }
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
}

/**
 * The recent-error list. An error recorded against a known source gets a
 * button that expands and scrolls to that source's card, named after the
 * source so eight identical "Show source" buttons never reach a screen
 * reader's button list.
 */
function RecentErrors ({ errors, sources, onJumpToSource }: RecentErrorsProps): React.ReactElement {
  const nameBySlug = new Map(sources.map((source) => [source.source, source.name]))
  return (
    <Banner tone='danger' title='Recent errors'>
      {/* A list Stack wraps each child in its own list item. */}
      <Stack as='ul' gap={2}>
        {errors.map(({ at, message, source }, index) => (
          <Cluster key={`${at}-${source ?? ''}-${message}-${index}`} gap={2}>
            <Text tone='muted' size='sm'><RelativeAge since={at} /></Text>
            <span>{message}</span>
            {source !== undefined && onJumpToSource !== undefined
              ? (
                <Button onClick={() => onJumpToSource(source)}>
                  Show {nameBySlug.get(source) ?? source}
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
  return (
    <Section
      title='Plugin status'
      actions={lastUpdatedMs !== null
        ? <Text tone='muted' size='sm'>Checked <RelativeAge since={lastUpdatedMs} /></Text>
        : undefined}
    >
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
          />
          )
        : null}
    </Section>
  )
})
