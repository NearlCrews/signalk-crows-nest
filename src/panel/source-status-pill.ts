/**
 * Pure helpers for the per-source status pill `DataSourceCard.tsx` renders in
 * each card header, and for the detail sentence the expanded card shows under
 * it. Lives in its own non-TSX module so the unit tests can import the
 * classification and wording without pulling in any React JSX (the test
 * tsconfig has `--jsx` off by design: source code targets the panel tsconfig,
 * tests target the node tsconfig).
 */

import { capitalizeFirst } from '../shared/strings.js'
import type { SourceStatus } from '../status/status-types.js'

/** The four variants the status pill renders in. */
export type PillVariant = 'idle' | 'waiting' | 'ok' | 'error'

/** The display content of a status pill and its detail line. */
export interface PillContent {
  /** The short label the header pill shows, e.g. `Healthy`. */
  label: string
  /**
   * The sentence the expanded card shows below the header, without its
   * trailing period. For the `ok` variant it names the count from the last
   * fetch and the card appends the fetch's relative age from `since`.
   */
  detail: string
  /** The last list fetch's timestamp, present only for the `ok` variant. */
  since?: string
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
 * Compose the short header label and the longer detail sentence for a pill in
 * the given state. The `ok` detail carries the count from the last fetch and
 * names the fetch timestamp so the card can show a live relative age.
 *
 * Every label is capitalized, and each names the source's state rather than
 * its severity. The badge's tone already contributes a word to the accessible
 * name, so the old lowercase `ok` and `error` read as "Success. ok" and
 * "Error. error": one of them a stutter, and neither adding anything the tone
 * had not already said. "Healthy" and "Unreachable" say what the source is
 * doing, and "Unreachable" is the word the status table beside it already
 * uses for the same condition.
 */
export function pillContent (status: SourceStatus, variant: PillVariant): PillContent {
  if (variant === 'error') {
    return { label: 'Unreachable', detail: 'Last request failed' }
  }
  if (variant === 'waiting') {
    // A transient deferral: the fetch is still running and the next refresh
    // serves it, so the short label stays calm and the full reason (e.g.
    // "list request exceeded 5s; result will appear on next refresh") is the
    // detail.
    const reason = status.lastSkip?.reason ?? 'result will appear on next refresh'
    return { label: 'Fetching', detail: capitalizeFirst(reason) }
  }
  if (variant === 'idle') {
    // A skipping source explains itself, e.g. "Idle: outside US waters", so an
    // intentionally quiet US-only source offshore does not read as broken. With
    // no reason it is simply awaiting its first request.
    if (status.lastSkip !== null) {
      return {
        label: `Idle: ${status.lastSkip.reason}`,
        detail: capitalizeFirst(status.lastSkip.reason)
      }
    }
    return { label: 'Idle', detail: 'Awaiting first request' }
  }
  const fetch = status.lastListFetch as Exclude<SourceStatus['lastListFetch'], null>
  // The pill reports source HEALTH, not the count from the last fetch:
  // the count is just "what fell inside the chartplotter's most recent
  // bounding-box query", which is meaningless until you pan the chart.
  // A user who sees "0 POI" on every collapsed card could reasonably think
  // nothing is selected, when in fact the sources are healthy and the
  // chart simply hasn't zoomed to anywhere with markers yet. The pill
  // says "ok"; the "N POIs in last fetch, M minutes ago" sentence shows
  // once the card is expanded.
  const detail = fetch.poiCount === 1
    ? '1 POI in last fetch'
    : `${fetch.poiCount} POIs in last fetch`
  return { label: 'Healthy', detail, since: fetch.at }
}
