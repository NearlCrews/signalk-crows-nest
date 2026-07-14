/**
 * React hook that polls the plugin's admin-gated status endpoint. It runs
 * inside the admin's authenticated session, so the gate is transparent. Polling
 * pauses while the document is hidden and resumes immediately when it becomes
 * visible again, so a backgrounded admin tab makes no needless requests.
 */

import { useEffect, useRef, useState } from 'react'
import { PLUGIN_ID } from '../../shared/plugin-id.js'
import { PANEL_REQUEST_TIMEOUT_MS } from '../request-timeout.js'
import type { StatusSnapshot } from '../../status/status-types.js'

/** The admin-gated status endpoint the plugin exposes through registerWithRouter. */
const STATUS_URL = `/plugins/${PLUGIN_ID}/api/status`

/** How often, in milliseconds, to poll the status endpoint while visible. */
const POLL_INTERVAL_MS = 5000

/** The status surface the panel consumes. */
export interface UseStatusResult {
  /** The most recent status snapshot, or null until the first poll succeeds. */
  status: StatusSnapshot | null
  /** A non-fatal message describing the last failed poll, or null. */
  error: string | null
  /**
   * Epoch milliseconds of the most recent successful poll, or null before
   * the first. Updated on every successful poll (unlike `status`, whose
   * identity is kept stable across byte-identical payloads), so the status
   * bar can show how fresh its readout is. The per-poll state change
   * re-renders the panel root each 5 s tick; the section components are
   * memoized so the tick reaches only the status bar.
   */
  lastUpdatedMs: number | null
}

/** Poll the plugin status endpoint and expose the latest snapshot. */
export function useStatus (): UseStatusResult {
  const [status, setStatus] = useState<StatusSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number | null>(null)
  const canceled = useRef(false)
  const inFlight = useRef(false)
  // The JSON of the last snapshot we committed to state, so a byte-identical
  // poll is detected with one stringify of the new body rather than
  // stringifying both the previous and the new snapshot every 5 s.
  const lastSnapshotJson = useRef<string | null>(null)

  useEffect(() => {
    canceled.current = false
    // Aborted on unmount so an outstanding request does not run to its
    // timeout against a component that is already gone.
    const unmountController = new AbortController()

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
          signal: AbortSignal.any([
            unmountController.signal,
            AbortSignal.timeout(PANEL_REQUEST_TIMEOUT_MS)
          ])
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const parsed: unknown = await response.json()
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('status response was not a JSON object')
        }
        const body = parsed as StatusSnapshot
        if (!canceled.current) {
          // Skip the state update when the payload is byte-identical to the
          // last one committed, so a downstream useMemo keyed on `status`
          // (DataSourcesSection.useStatusBySource, the per-card status prop)
          // keeps stable identity across polls and the DataSourceCards
          // do not re-render once per 5 s for no user-visible change.
          // JSON.stringify is the cheap canonical comparison for a snapshot in
          // the kilobyte range; comparing against the stored JSON stringifies
          // only the new body, not both snapshots.
          const json = JSON.stringify(body)
          if (lastSnapshotJson.current !== json) {
            lastSnapshotJson.current = json
            setStatus(body)
          }
          setLastUpdatedMs(Date.now())
          setError(null)
        }
      } catch (e) {
        if (!canceled.current) {
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
      canceled.current = true
      unmountController.abort()
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return { status, error, lastUpdatedMs }
}
