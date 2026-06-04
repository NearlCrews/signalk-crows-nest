/**
 * Live status bar: a small bordered card at the top of the panel that
 * lists one row per enabled POI source (name, reachability dot + label,
 * and the relative time of the last list fetch), plus any recent
 * errors. Driven entirely by the StatusSnapshot polled from the plugin.
 *
 * The bar reports source HEALTH, not the count returned by the most
 * recent list call. The count is just "what fell inside the
 * chart-plotter's last bounding-box query" and is meaningless until
 * the chart is panned, so showing it here (or in the per-card pill)
 * reads as misleading.
 */

import type * as React from 'react'
import type { SourceStatus, StatusSnapshot } from '../../status/status-types.js'
import { relativeTime } from '../relative-time.js'
import { S } from '../styles.js'

// The dot base merged with each state variant once at module load, rather than
// rebuilding the merged object on every row of every 5 s poll render.
const DOT_OK: React.CSSProperties = { ...S.dot, ...S.dotOk }
const DOT_OFF: React.CSSProperties = { ...S.dot, ...S.dotOff }
const DOT_ERROR: React.CSSProperties = { ...S.dot, ...S.dotError }

/** Map the tri-state apiReachable flag to a status dot style and label. */
function apiState (reachable: boolean | null): { dot: React.CSSProperties, label: string } {
  if (reachable === true) return { dot: DOT_OK, label: 'reachable' }
  if (reachable === false) return { dot: DOT_ERROR, label: 'unreachable' }
  return { dot: DOT_OFF, label: 'not yet contacted' }
}

/**
 * One row in the status grid: dot, source name, state, last-fetch
 * time. Wrapped in a `display: contents` div so the four spans flow
 * directly into the parent grid's four columns. The wrapper also pins
 * the 4-cells-per-source contract: a future fifth cell would land
 * outside this wrapper, making any drift visible. No ARIA table roles
 * are applied: this is a read-only health readout, not an interactive
 * data grid, so the spans read in DOM order (name, state, last fetch)
 * rather than as a headerless and therefore malformed table.
 */
function SourceRow ({ source }: { source: SourceStatus }): React.ReactElement {
  const api = apiState(source.apiReachable)
  const fetched = source.lastListFetch === null
    ? 'no fetch yet'
    : `updated ${relativeTime(source.lastListFetch.at)}`
  return (
    <div style={S.statusGridRow}>
      <span style={api.dot} aria-hidden='true' />
      <span style={S.statusGridName}>{source.name}</span>
      <span style={S.statusGridState}>{api.label}</span>
      <span style={S.statusGridFetch}>{fetched}</span>
    </div>
  )
}

interface Props {
  status: StatusSnapshot | null
}

/** The status bar shown at the top of the configuration panel. */
export default function StatusBar ({ status }: Props): React.ReactElement {
  // The loading state and the populated state both render the title
  // plus a fixed-height body region. The body reserves a min-height so
  // the bar does not visibly grow when the first poll resolves and
  // swaps the loading line for the source-health grid.
  // The bar is a passive health readout, not a live region: it carries no
  // role='status'. The relative "N minutes ago" text re-renders on every 5 s
  // poll, so announcing the whole bar on each change would be pure noise. The
  // transient "Saved" confirmation in FooterBar remains the one polite live
  // region, which is the right number for the panel.
  if (status === null) {
    return (
      <div style={S.statusBar}>
        <span style={S.statusBarTitle}>Plugin status</span>
        <div style={S.statusBarBody}>
          <span style={S.statusBarLoading}>
            <span style={DOT_OFF} aria-hidden='true' />
            Loading status...
          </span>
        </div>
      </div>
    )
  }

  const { sources, recentErrors } = status

  return (
    <div style={S.statusBar}>
      <span style={S.statusBarTitle}>Plugin status</span>
      <div style={S.statusBarBody}>
        {sources.length === 0
          ? <span style={S.statusBarEmpty}>No data source enabled yet. Open a card below and toggle one on.</span>
          : (
            <div style={S.statusGrid}>
              {sources.map((source) => <SourceRow key={source.source} source={source} />)}
            </div>
            )}
      </div>
      {recentErrors.length > 0
        ? (
          <ul style={S.statusErrors} aria-label='Recent errors'>
            {recentErrors.map((err) => (
              <li key={`${err.at}-${err.message}`} style={S.statusErrorItem}>
                <span style={S.statusErrorTime}>{relativeTime(err.at)}</span>
                <span>{err.message}</span>
              </li>
            ))}
          </ul>
          )
        : null}
    </div>
  )
}
