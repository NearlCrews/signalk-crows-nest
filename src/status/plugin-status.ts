/**
 * Request-outcome recorder for the plugin.
 *
 * The plugin's POI sources call these recording methods around their API
 * calls; the status endpoint reads a StatusSnapshot back out. The recorder
 * holds only observed outcomes, so producing a snapshot generates no extra API
 * traffic: each source's `apiReachable` is derived passively from whether that
 * source's most recent request succeeded or failed.
 *
 * Status is per-source: the recorder is created with the run's enabled
 * sources, and every recording method names the source the outcome belongs to.
 * The recent-errors list stays global, capped at a small fixed count.
 */

import type { LastListFetch, LastSkip, SourceStatus, StatusError, StatusSnapshot } from './status-types.js'

/** Upper bound on retained errors. Older entries are dropped past this count. */
const MAX_RECENT_ERRORS = 5

/** Identity of one enabled POI source, used to build its status row. */
export interface StatusSource {
  /** Source slug, e.g. `activecaptain`. */
  source: string
  /** Human-readable source name. */
  name: string
}

/** Records request outcomes and produces a StatusSnapshot on demand. */
export interface PluginStatus {
  /** Record a successful list fetch from `source` that returned `poiCount` points of interest. */
  recordListFetch: (source: string, poiCount: number) => void
  /** Record a successful point-of-interest detail resolution from `source`. */
  recordDetailSuccess: (source: string) => void
  /**
   * Record a failed request, attributing it to `source` and keeping the
   * message in the global recent-errors list.
   */
  recordError: (source: string, message: string) => void
  /**
   * Record that a source chose not to issue a request, e.g. because the vessel
   * is outside US waters and the source covers US data only. A skip is not a
   * failure: it leaves `apiReachable` and `lastListFetch` untouched and is not
   * added to the recent-errors list. It does raise the per-source suppression
   * flag the aggregate input registry reads (and consumes) through
   * {@link wasListFetchSuppressed} so a follow-on `recordListFetch(0)` does not
   * overwrite the previous fetch with a bogus "fetched zero POIs" success. The
   * `reason` is retained on the source row as `lastSkip` so the panel can
   * explain why a quiet source is idle; a later successful or failed request
   * clears it. `transient` marks a deferral rather than a deliberate gate (a
   * list request that outran the aggregate's per-source timeout and will be
   * served from cache on the next refresh), which the panel renders as waiting
   * instead of idle.
   */
  recordSkipped: (source: string, reason: string, transient?: boolean) => void
  /**
   * Record that a source served a stale result from its on-disk cache because
   * the upstream was unreachable (an offline restart, say). This is NOT a
   * reachable list fetch: it sets `apiReachable` false and logs the outage, so
   * the source reads as in error even while its cached markers stay on the
   * chart. It also raises the same suppression flag as {@link recordSkipped},
   * so the follow-on fulfilled result is not laundered into a "fetched N
   * points" reachable success. Optional only so a lightweight test stub need
   * not implement it; the production recorder always does.
   */
  recordStaleServe?: (source: string, reason: string) => void
  /**
   * True when the source's most recent recorded event was a skip or a stale
   * offline serve, i.e. the fulfilled list result the aggregate just received
   * did not come from a reachable upstream fetch and must not be recorded as
   * one. Reading the flag CONSUMES it: it reflects only the event immediately
   * preceding the read, so a later real fetch is recorded normally rather than
   * suppressed.
   */
  wasListFetchSuppressed: (source: string) => boolean
  /**
   * Produce a point-in-time snapshot. The caller supplies `cachedPoiCount`
   * because the cached entry count is owned by the cache, not the recorder.
   */
  snapshot: (cachedPoiCount: number) => StatusSnapshot
}

/** Mutable health of one source, accumulated as outcomes are recorded. */
interface SourceState {
  name: string
  apiReachable: boolean | null
  lastListFetch: LastListFetch | null
  /**
   * Set by {@link PluginStatus.recordSkipped} and
   * {@link PluginStatus.recordStaleServe}, cleared on read by
   * {@link PluginStatus.wasListFetchSuppressed} (and by the next
   * `recordListFetch`/`recordError` for the same source). The aggregate input
   * registry reads this flag to decide whether the fulfilled list result it
   * just received came from a reachable upstream fetch; consuming it on read
   * keeps the suppression strictly per-call.
   */
  suppressListFetch: boolean
  /**
   * The reason and transience from the most recent
   * {@link PluginStatus.recordSkipped}, or null when the source is not
   * currently skipping. Unlike {@link suppressListFetch} this is not consumed
   * on read: it persists on the snapshot so the panel can label a quiet source
   * with why, and is cleared by the next real
   * `recordListFetch`/`recordDetailSuccess`/`recordError`.
   */
  lastSkip: LastSkip | null
}

/**
 * Create a PluginStatus recorder for a run's enabled sources. `startedAt` is
 * captured here, so a fresh recorder is created on each plugin start to
 * reflect the current run. An outcome recorded against a source not in
 * `sources` still lands in the global recent-errors list but updates no row.
 */
export function createPluginStatus (sources: ReadonlyArray<StatusSource>): PluginStatus {
  const startedAt = new Date().toISOString()
  const recentErrors: StatusError[] = []
  // A Map preserves insertion order, so the snapshot lists sources in
  // registration order.
  const states = new Map<string, SourceState>()
  for (const { source, name } of sources) {
    states.set(source, {
      name,
      apiReachable: null,
      lastListFetch: null,
      suppressListFetch: false,
      lastSkip: null
    })
  }

  /**
   * Mark `source` reachable in its state row, if it has one. Shared by
   * `recordListFetch` and `recordDetailSuccess` so the lookup-and-guard
   * pattern lives in one place.
   */
  function markReachable (source: string): SourceState | undefined {
    const state = states.get(source)
    if (state !== undefined) {
      state.apiReachable = true
      // A real request succeeded, so the source is no longer skipping or serving
      // stale: drop the skip so the panel stops labeling it as quiet.
      state.lastSkip = null
    }
    return state
  }

  return {
    recordListFetch: (source: string, poiCount: number): void => {
      const state = markReachable(source)
      if (state !== undefined) {
        state.lastListFetch = { at: new Date().toISOString(), poiCount }
        state.suppressListFetch = false
      }
    },

    recordDetailSuccess: (source: string): void => {
      markReachable(source)
    },

    recordError: (source: string, message: string): void => {
      const state = states.get(source)
      if (state !== undefined) {
        state.apiReachable = false
        state.suppressListFetch = false
        // A real request failed, so this is no longer a skip: clear it. The
        // error variant outranks idle on the pill regardless, but keeping the
        // row clean avoids a stale "outside US waters" label riding alongside
        // a fresh failure.
        state.lastSkip = null
      }
      recentErrors.unshift({ at: new Date().toISOString(), message, source })
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.length = MAX_RECENT_ERRORS
      }
    },

    // A skip is observational: the source declined to issue a request, which
    // is not an outcome to record against `apiReachable` and not an error to
    // surface in the recent-errors list. Raising `suppressListFetch` lets the
    // aggregate input registry distinguish a "fetched zero POIs" success
    // from a "did not bother" skip when it sees the empty result that
    // follows. `reason` (the caller's skip explanation, e.g. "outside US
    // waters") is retained on `lastSkip` so the panel can explain why the
    // source is quiet; `transient` marks a deferral the panel shows as
    // waiting rather than idle.
    recordSkipped: (source: string, reason: string, transient = false): void => {
      const state = states.get(source)
      if (state !== undefined) {
        state.suppressListFetch = true
        state.lastSkip = { reason, transient }
      }
    },

    // A stale offline serve is a real outage that still shows cached markers:
    // mark the source unreachable and log the reason, but flag the result so
    // the aggregate does not count it as a reachable list fetch. The message is
    // count-free so a burst of identical offline ticks collapses to one
    // recent-errors entry rather than crowding out other sources' errors.
    recordStaleServe: (source: string, reason: string): void => {
      const state = states.get(source)
      if (state !== undefined) {
        state.apiReachable = false
        state.suppressListFetch = true
        // Not a skip: leave lastSkip null so the pill reads as error (honest
        // about the unreachable upstream) rather than idle.
        state.lastSkip = null
      }
      const message = `Serving cached data offline: ${reason}`
      if (!recentErrors.some((error) => error.source === source && error.message === message)) {
        recentErrors.unshift({ at: new Date().toISOString(), message, source })
        if (recentErrors.length > MAX_RECENT_ERRORS) {
          recentErrors.length = MAX_RECENT_ERRORS
        }
      }
    },

    wasListFetchSuppressed: (source: string): boolean => {
      const state = states.get(source)
      if (state === undefined) {
        return false
      }
      // Consume on read so a real fetch after a skip or a stale serve is
      // recorded rather than suppressed: without this the registry's gate
      // would never re-open.
      const suppressed = state.suppressListFetch
      state.suppressListFetch = false
      return suppressed
    },

    snapshot: (cachedPoiCount: number): StatusSnapshot => ({
      sources: [...states.entries()].map(([source, state]): SourceStatus => ({
        source,
        name: state.name,
        apiReachable: state.apiReachable,
        lastListFetch: state.lastListFetch,
        lastSkip: state.lastSkip
      })),
      cachedPoiCount,
      recentErrors: recentErrors.slice(),
      startedAt
    })
  }
}
