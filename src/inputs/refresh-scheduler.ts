/**
 * Shared periodic-refresh scheduler for the full-download inputs.
 *
 * The USCG Light List, NOAA CO-OPS, and USCG Local Notice to Mariners inputs
 * each re-download their whole dataset on a fixed cadence rather than per
 * viewport. They all need the same mechanics: an initial delayed refresh after
 * plugin start, a periodic refresh on an interval, an in-flight guard so a slow
 * pass never lets the next tick start a second `refreshAll` that races the
 * store writes, and a `close` that clears both timers. This installer owns that
 * shared machinery so each input module only supplies its own dataset,
 * interval, and log name.
 */

import type { ServerAPI } from '@signalk/server-api'
import { MS_PER_SECOND } from '../shared/time.js'

/** Delay before the first refresh fires after a plugin start, in seconds. */
const INITIAL_REFRESH_DELAY_SECONDS = 30

/** A store whose on-disk index is read asynchronously at input start. */
export interface LoadableStore {
  /** Read the persisted index. Rejects when the file is missing or unreadable. */
  load: () => Promise<unknown>
}

/**
 * Start a store's on-disk load without waiting for it, so a refresh fired by
 * the scheduler reads a hot index.
 *
 * A failure is logged and swallowed rather than blocking plugin start: the
 * store falls back to an empty index, which the next successful refresh
 * repopulates from upstream. The three full-download inputs all want exactly
 * this, so the pattern lives here beside the scheduler rather than in three
 * copies that could drift on whether a load failure is fatal.
 */
export function loadStoreInBackground (store: LoadableStore, app: ServerAPI, name: string): void {
  store.load().catch((error: unknown) => {
    app.debug(`${name} index load failed: ${String(error)}`)
  })
}

/** A source that can be periodically refreshed and closed. */
export interface RefreshableSource {
  /** Run one full refresh pass. Rejects on failure. */
  refreshAll: (signal?: AbortSignal) => Promise<void>
  /** Release resources. Wrapped by the scheduler to also clear its timers. */
  close: () => void
}

/** Options for {@link startRefreshScheduler}. */
export interface RefreshSchedulerOptions<S extends RefreshableSource> {
  /** The source to refresh; its `close` is wrapped to clear the timers. */
  source: S
  /** The SignalK app, for `app.debug` skip and failure logging. */
  app: ServerAPI
  /** Log name prefixing the debug messages, e.g. `USCG Light List`. */
  name: string
  /** Interval between periodic refreshes, in milliseconds. */
  intervalMs: number
  /** Initial delay override for tests. Defaults to 30 seconds. */
  initialDelayMs?: number
}

/**
 * Install the initial and periodic refresh timers on a source and wrap its
 * `close` to clear them, returning the same source. The in-flight guard skips
 * an overlapping tick (logging `<name> <reason> skipped: previous refresh still
 * running`) and a rejected pass logs `<name> <reason> failed: <error>`; the
 * next interval fires normally either way.
 */
export function startRefreshScheduler<S extends RefreshableSource> (
  options: RefreshSchedulerOptions<S>
): S {
  const { source, app, name, intervalMs } = options
  const initialDelayMs = options.initialDelayMs ?? INITIAL_REFRESH_DELAY_SECONDS * MS_PER_SECOND

  let refreshing = false
  const abortController = new AbortController()
  const runRefresh = (reason: string): void => {
    if (refreshing) {
      app.debug(`${name} ${reason} skipped: previous refresh still running`)
      return
    }
    refreshing = true
    source.refreshAll(abortController.signal)
      .catch(error => {
        if (!abortController.signal.aborted) {
          app.debug(`${name} ${reason} failed: ${String(error)}`)
        }
      })
      .finally(() => { refreshing = false })
  }

  const initialTimer = setTimeout(() => { runRefresh('initial refresh') }, initialDelayMs)
  const periodicTimer = setInterval(() => { runRefresh('refresh') }, intervalMs)
  const originalClose = source.close.bind(source)
  source.close = () => {
    clearTimeout(initialTimer)
    clearInterval(periodicTimer)
    abortController.abort()
    originalClose()
  }
  return source
}
