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

import type { LastListFetch, SourceStatus, StatusError, StatusSnapshot } from './status-types.js'

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
   * added to the recent-errors list. It does set a per-source `justSkipped`
   * flag that the aggregate input registry reads through
   * {@link wasJustSkipped} so a follow-on `recordListFetch(0)` does not
   * overwrite the previous fetch with a bogus "fetched zero POIs" success.
   */
  recordSkipped: (source: string, reason: string) => void
  /**
   * True when `recordSkipped` was the most recent recording call for the
   * source: the source declined to issue a request and any follow-on empty
   * list result should be treated as a skip, not a "fetched zero POIs"
   * success. The flag clears the next time `recordListFetch` or
   * `recordError` records a real outcome for that source.
   */
  wasJustSkipped: (source: string) => boolean
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
   * Set by {@link PluginStatus.recordSkipped} and cleared by the next
   * `recordListFetch`/`recordError` for the same source. The aggregate
   * input registry reads this flag through {@link PluginStatus.wasJustSkipped}
   * to decide whether an empty list result is a "fetched zero POIs" success
   * or a "did not bother" skip that should leave the row untouched.
   */
  justSkipped: boolean
  /**
   * Human-readable reason passed to the most recent `recordSkipped` call
   * (e.g. "outside US waters"). Retained for future diagnostics, including
   * a planned status-snapshot field. Cleared together with `justSkipped`.
   */
  lastSkipReason: string | null
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
      name, apiReachable: null, lastListFetch: null, justSkipped: false, lastSkipReason: null
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
    }
    return state
  }

  return {
    recordListFetch: (source: string, poiCount: number): void => {
      const state = markReachable(source)
      if (state !== undefined) {
        state.lastListFetch = { at: new Date().toISOString(), poiCount }
        state.justSkipped = false
        state.lastSkipReason = null
      }
    },

    recordDetailSuccess: (source: string): void => {
      markReachable(source)
    },

    recordError: (source: string, message: string): void => {
      const state = states.get(source)
      if (state !== undefined) {
        state.apiReachable = false
        state.justSkipped = false
        state.lastSkipReason = null
      }
      recentErrors.unshift({ at: new Date().toISOString(), message })
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.length = MAX_RECENT_ERRORS
      }
    },

    // A skip is observational: the source declined to issue a request, which
    // is not an outcome to record against `apiReachable` and not an error to
    // surface in the recent-errors list. Setting `justSkipped` lets the
    // aggregate input registry distinguish a "fetched zero POIs" success
    // from a "did not bother" skip when it sees the empty result that
    // follows.
    recordSkipped: (source: string, reason: string): void => {
      const state = states.get(source)
      if (state !== undefined) {
        state.justSkipped = true
        state.lastSkipReason = reason
      }
    },

    wasJustSkipped: (source: string): boolean => {
      return states.get(source)?.justSkipped === true
    },

    snapshot: (cachedPoiCount: number): StatusSnapshot => ({
      sources: [...states.entries()].map(([source, state]): SourceStatus => ({
        source,
        name: state.name,
        apiReachable: state.apiReachable,
        lastListFetch: state.lastListFetch
      })),
      cachedPoiCount,
      recentErrors: recentErrors.slice(),
      startedAt
    })
  }
}
