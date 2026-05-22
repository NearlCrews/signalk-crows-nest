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
    states.set(source, { name, apiReachable: null, lastListFetch: null })
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
      }
    },

    recordDetailSuccess: (source: string): void => {
      markReachable(source)
    },

    recordError: (source: string, message: string): void => {
      const state = states.get(source)
      if (state !== undefined) {
        state.apiReachable = false
      }
      recentErrors.unshift({ at: new Date().toISOString(), message })
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.length = MAX_RECENT_ERRORS
      }
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
