/**
 * Pure helpers for the per-source status pill rendered by
 * `DataSourceCard.tsx`. Lives in its own non-TSX module so the unit
 * tests can import the variant + content logic without pulling in any
 * React JSX (the test tsconfig has `--jsx` off by design: source code
 * targets the panel tsconfig, tests target the node tsconfig).
 */

import { relativeTime } from './relative-time.js'
import type { SourceStatus } from '../status/status-types.js'

/** The four variants the status pill renders in. */
export type PillVariant = 'idle' | 'waiting' | 'ok' | 'error'

/** The display content of a status pill: the glyph, the short label, and the long tooltip. */
export interface PillContent {
  glyph: string
  label: string
  title: string
}

/**
 * Classify a SourceStatus into one of the four pill variants:
 *  - `'error'` whenever the most recent attempt failed (apiReachable=false),
 *  - `'waiting'` when the source's last recorded action was a transient
 *    deferral (a list request that outran the aggregate's per-source timeout
 *    and will be served from cache on the next refresh),
 *  - `'idle'` when the source is deliberately skipping (lastSkip set) or has
 *    not resolved a list fetch yet (lastListFetch=null), and
 *  - `'ok'` otherwise.
 *
 * The error branch outranks the rest: a source with a failed most-recent
 * attempt but a still-cached stale prior fetch still reads as in error. A set
 * `lastSkip` means the source's last recorded action was a skip (the recorder
 * clears it on the next real request), so it reads as waiting or idle even
 * when a stale prior fetch is on file: a quiet source should not masquerade
 * as freshly ok.
 */
export function pillVariant (status: SourceStatus): PillVariant {
  if (status.apiReachable === false) return 'error'
  if (status.lastSkip !== null) return status.lastSkip.transient ? 'waiting' : 'idle'
  if (status.lastListFetch === null) return 'idle'
  return 'ok'
}

/**
 * Compose the visible glyph + short label and the longer tooltip text
 * for a pill in the given state. The `ok` tooltip includes a relative
 * "last fetch N minutes ago" reading so a stale snapshot is visible on
 * hover.
 */
export function pillContent (status: SourceStatus, variant: PillVariant): PillContent {
  if (variant === 'error') {
    return { glyph: '!', label: 'error', title: `${status.name}: last request failed` }
  }
  if (variant === 'waiting') {
    // A transient deferral: the fetch is still running and the next refresh
    // serves it, so the short label stays calm and the full reason (e.g.
    // "list request exceeded 5s; result will appear on next refresh") rides
    // the hover title.
    const reason = status.lastSkip?.reason ?? 'result will appear on next refresh'
    return { glyph: '…', label: 'waiting', title: `${status.name}: ${reason}` }
  }
  if (variant === 'idle') {
    // A skipping source explains itself, e.g. "Idle: outside US waters", so an
    // intentionally quiet US-only source offshore does not read as broken. With
    // no reason it is simply awaiting its first request.
    if (status.lastSkip !== null) {
      return {
        glyph: '…',
        label: `Idle: ${status.lastSkip.reason}`,
        title: `${status.name}: ${status.lastSkip.reason}`
      }
    }
    return { glyph: '…', label: 'idle', title: `${status.name}: awaiting first request` }
  }
  const fetch = status.lastListFetch as Exclude<SourceStatus['lastListFetch'], null>
  // The pill reports source HEALTH, not the count from the last fetch:
  // the count is just "what fell inside the chartplotter's most recent
  // bounding-box query", which is meaningless until you pan the chart.
  // A user who sees "✓ 0 POI" on every source could reasonably think
  // nothing is selected, when in fact the sources are healthy and the
  // chart simply hasn't zoomed to anywhere with markers yet. The pill
  // says "ok"; the longer "N POIs in last fetch, M minutes ago" lives
  // in the hover/aria title.
  const countText = fetch.poiCount === 1
    ? '1 POI in last fetch'
    : `${fetch.poiCount} POIs in last fetch`
  return {
    glyph: '✓',
    label: 'ok',
    title: `${status.name}: ${countText}, ${relativeTime(fetch.at)}`
  }
}
