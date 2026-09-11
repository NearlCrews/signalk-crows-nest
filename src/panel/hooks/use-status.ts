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

/**
 * What to tell the operator about a failed poll.
 *
 * The raw `HTTP 401` a thrown status carried was developer text, and the
 * panel pairs every failure with "the next poll will retry automatically",
 * which is a promise the retry cannot keep for an authentication failure: the
 * endpoint is admin-gated, so 401 and 403 mean the admin session has gone and
 * no number of retries brings it back. Everything else, a 5xx, a timeout, or
 * a dropped connection, does recover on its own.
 */
export interface StatusPollError {
  /** One sentence naming what went wrong, in the operator's terms. */
  message: string
  /** Whether the next poll can recover it without the operator acting. */
  recoverable: boolean
}

/** Describe an HTTP status the poll rejected on. */
function httpError (status: number): StatusPollError {
  if (status === 401 || status === 403) {
    return {
      message: 'The admin session is no longer signed in',
      recoverable: false
    }
  }
  return { message: `The plugin returned HTTP ${status}`, recoverable: true }
}

/** The status surface the panel consumes. */
export interface UseStatusResult {
  /** The most recent status snapshot, or null until the first poll succeeds. */
  status: StatusSnapshot | null
  /** The last failed poll, or null while the endpoint is answering. */
  error: StatusPollError | null
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
  const [error, setError] = useState<StatusPollError | null>(null)
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

    /**
     * Record a failed poll, keeping the previous description when the failure
     * has not changed.
     *
     * A description is built fresh on every failed poll, so committing it
     * unconditionally would re-render the panel root every 5 s for the length
     * of an outage, where the string this used to hold settled into no
     * re-renders at all. Comparing inside the update leaves the success path
     * with nothing to reset.
     */
    function commitError (next: StatusPollError): void {
      if (canceled.current) return
      setError((previous) => (
        previous !== null &&
        previous.message === next.message &&
        previous.recoverable === next.recoverable
      )
        ? previous
        : next)
    }

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
        // A rejected response is an ordinary outcome of a poll rather than an
        // exception, so it is reported here instead of being thrown to a
        // catch twenty lines below in the same function.
        if (!response.ok) {
          commitError(httpError(response.status))
          return
        }
        const parsed: unknown = await response.json()
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('The plugin sent a status response the panel could not read')
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
        // A timeout, an aborted request, a dropped connection, or a body the
        // panel could not read. All of them are transient by nature, so the
        // retry promise holds.
        commitError({ message: e instanceof Error ? e.message : String(e), recoverable: true })
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
