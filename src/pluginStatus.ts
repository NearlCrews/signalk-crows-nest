/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Request-outcome recorder for the plugin.
 *
 * The plugin calls these recording methods around its ActiveCaptain client
 * calls; the status endpoint reads a StatusSnapshot back out. The recorder
 * holds only observed outcomes, so producing a snapshot generates no extra
 * Garmin API traffic: `apiReachable` is derived passively from whether the
 * most recent request succeeded or failed.
 */

import type { LastListFetch, StatusError, StatusSnapshot } from './statusTypes.js'

/** Upper bound on retained errors. Older entries are dropped past this count. */
const MAX_RECENT_ERRORS = 5

/** Records request outcomes and produces a StatusSnapshot on demand. */
export interface PluginStatus {
  /** Record a successful list fetch that returned `poiCount` points of interest. */
  recordListFetch: (poiCount: number) => void
  /** Record a successful point-of-interest detail resolution. */
  recordDetailSuccess: () => void
  /** Record a failed request, keeping the message in the recent-errors list. */
  recordError: (message: string) => void
  /**
   * Produce a point-in-time snapshot. The caller supplies `cachedPoiCount`
   * because the cached entry count is owned by the cache, not the recorder.
   */
  snapshot: (cachedPoiCount: number) => StatusSnapshot
}

/**
 * Create a PluginStatus recorder. `startedAt` is captured here, so a fresh
 * recorder is created on each plugin start to reflect the current run.
 */
export function createPluginStatus (): PluginStatus {
  const startedAt = new Date().toISOString()
  let apiReachable: boolean | null = null
  let lastListFetch: LastListFetch | null = null
  const recentErrors: StatusError[] = []

  return {
    recordListFetch: (poiCount: number): void => {
      apiReachable = true
      lastListFetch = { at: new Date().toISOString(), poiCount }
    },

    recordDetailSuccess: (): void => {
      apiReachable = true
    },

    recordError: (message: string): void => {
      apiReachable = false
      recentErrors.unshift({ at: new Date().toISOString(), message })
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.length = MAX_RECENT_ERRORS
      }
    },

    snapshot: (cachedPoiCount: number): StatusSnapshot => ({
      apiReachable,
      lastListFetch,
      cachedPoiCount,
      recentErrors: recentErrors.slice(),
      startedAt
    })
  }
}
