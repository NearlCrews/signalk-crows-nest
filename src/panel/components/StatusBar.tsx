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
 * Live status bar: an ActiveCaptain reachability dot, the cached POI count, the
 * last successful list fetch, and any recent errors. Driven entirely by the
 * StatusSnapshot polled from the plugin.
 */

import type * as React from 'react'
import type { StatusSnapshot } from '../../statusTypes.js'
import { S } from '../styles.js'

/** Render an ISO-8601 timestamp as a localised, relative phrase such as "5 minutes ago". */
function relativeTime (iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso

  const deltaSeconds = Math.round((then - Date.now()) / 1000)
  const absSeconds = Math.abs(deltaSeconds)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (absSeconds < 60) return format.format(deltaSeconds, 'second')
  if (absSeconds < 3600) return format.format(Math.round(deltaSeconds / 60), 'minute')
  if (absSeconds < 86400) return format.format(Math.round(deltaSeconds / 3600), 'hour')
  return format.format(Math.round(deltaSeconds / 86400), 'day')
}

/** Map the tri-state apiReachable flag to a status dot style and label. */
function apiState (reachable: boolean | null): { dot: React.CSSProperties, label: string } {
  if (reachable === true) return { dot: S.dotOk, label: 'API reachable' }
  if (reachable === false) return { dot: S.dotError, label: 'API unreachable' }
  return { dot: S.dotOff, label: 'API not yet contacted' }
}

interface Props {
  status: StatusSnapshot | null
}

/** The status bar shown at the top of the configuration panel. */
export default function StatusBar ({ status }: Props): React.ReactElement {
  if (status === null) {
    return (
      <div style={S.statusBar} role='status'>
        <span style={{ ...S.dot, ...S.dotOff }} aria-hidden='true' />
        <span>Loading status...</span>
      </div>
    )
  }

  const api = apiState(status.apiReachable)
  const { lastListFetch, recentErrors } = status

  return (
    <div style={S.statusBar} role='status'>
      <span style={S.statusApi}>
        <span style={{ ...S.dot, ...api.dot }} aria-hidden='true' />
        <span>{api.label}</span>
      </span>
      <span>
        <span style={S.statLabel}>Cached POIs</span>
        <span style={S.statValue}>{status.cachedPoiCount}</span>
      </span>
      <span>
        <span style={S.statLabel}>Last fetch</span>
        <span style={S.statValue}>
          {lastListFetch === null
            ? 'none yet'
            : `${relativeTime(lastListFetch.at)} (${lastListFetch.poiCount} POIs)`}
        </span>
      </span>
      {recentErrors.length > 0
        ? (
          <ul style={S.statusErrors}>
            {recentErrors.map((err, index) => (
              <li key={`${err.at}-${index}`} style={S.statusErrorItem}>
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
