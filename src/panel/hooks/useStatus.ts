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
 * React hook that polls the plugin's admin-gated status endpoint. It runs
 * inside the admin's authenticated session, so the gate is transparent. Polling
 * pauses while the document is hidden and resumes immediately when it becomes
 * visible again, so a backgrounded admin tab makes no needless requests.
 */

import { useEffect, useRef, useState } from 'react'
import { PLUGIN_ID } from '../../pluginId.js'
import type { StatusSnapshot } from '../../statusTypes.js'

/** The admin-gated status endpoint the plugin exposes through registerWithRouter. */
const STATUS_URL = `/plugins/${PLUGIN_ID}/api/status`

/** How often, in milliseconds, to poll the status endpoint while visible. */
const POLL_INTERVAL_MS = 5000

/**
 * Per-request timeout. Kept below the poll interval so a hung request clears
 * before the next tick rather than letting requests pile up.
 */
const REQUEST_TIMEOUT_MS = 4000

/** The status surface the panel consumes. */
export interface UseStatusResult {
  /** The most recent status snapshot, or null until the first poll succeeds. */
  status: StatusSnapshot | null
  /** A non-fatal message describing the last failed poll, or null. */
  error: string | null
}

/** Poll the plugin status endpoint and expose the latest snapshot. */
export function useStatus (): UseStatusResult {
  const [status, setStatus] = useState<StatusSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const inFlight = useRef(false)

  useEffect(() => {
    cancelled.current = false

    // poll never rejects: it catches its own failures and surfaces them
    // through setError, so callers can leave its promise unhandled.
    async function poll (): Promise<void> {
      // Skip if a previous poll is still running, so a slow endpoint cannot
      // stack overlapping requests whose responses then arrive out of order.
      if (inFlight.current) {
        return
      }
      inFlight.current = true
      try {
        const response = await fetch(STATUS_URL, {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json() as StatusSnapshot
        if (!cancelled.current) {
          setStatus(body)
          setError(null)
        }
      } catch (e) {
        if (!cancelled.current) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        inFlight.current = false
      }
    }

    poll()
    const intervalId = setInterval(() => {
      if (!document.hidden) poll()
    }, POLL_INTERVAL_MS)

    // A poll skipped while hidden would otherwise leave stale data on screen
    // until the next interval; refresh as soon as the tab is shown again.
    const onVisibilityChange = (): void => {
      if (!document.hidden) poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled.current = true
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return { status, error }
}
