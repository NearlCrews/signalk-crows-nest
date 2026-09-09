/**
 * Bridge clearance resolver.
 *
 * Resolves a bridge POI's vertical clearance, in meters, for the air-draft
 * check, bridging the gap between the synchronous per-tick scan and
 * ActiveCaptain, whose `bridgeHeight` lives only in the per-POI detail
 * response rather than in the list summary the scan sees.
 *
 * - When the summary already carries `verticalClearanceMeters` (OpenSeaMap at
 *   list time, or a value the dedupe pass carried onto a base POI), it is
 *   returned synchronously.
 * - For an ActiveCaptain bridge with no clearance on the summary, the resolver
 *   kicks off a deduped, fire-and-forget `getDetails` (which is itself
 *   TTL-and-disk cached) and returns `null` for this tick. The resolved value
 *   is cached (with a freshness TTL after which a later encounter re-resolves
 *   it, picking up an upstream correction), so a later tick returns it while
 *   it is fresh. The scan box is far wider than the
 *   alarm radius, so a one-tick lag before an ActiveCaptain clearance is known
 *   never costs a real alarm.
 * - Any other bridge with no clearance resolves to `null` with no fetch: no
 *   other source exposes a clearance the summary did not already carry.
 *
 * `null` from {@link BridgeClearanceResolver.clearanceMeters} means "no usable
 * clearance right now," which the callers treat as "do not warn." A transient
 * `getDetails` failure is not cached as a clearance, so the bridge is retried
 * on a later encounter rather than being pinned to "unknown" for the session.
 * The retry is rate-limited rather than free: see
 * {@link FAILED_FETCH_RETRY_MS}.
 */

import { LRUCache } from 'lru-cache'
import { ACTIVE_CAPTAIN_SOURCE_ID } from '../../shared/source-ids.js'
import { BRIDGE_POI_TYPE } from './bridge-clearance-alarms.js'
import { MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import { MINUTES_PER_DAY, MS_PER_MINUTE } from '../../shared/time.js'
import { positiveFiniteNumber, toFiniteNumber } from '../../shared/numbers.js'
import type { PoiDetailView, PoiSummary } from '../../shared/types.js'

/**
 * Default freshness window for a resolved clearance, in minutes: 24 hours.
 * Bridge clearances are physically static, so the window exists only to pick
 * up an upstream data correction; a daily re-resolve catches that without a
 * plugin restart while keeping any single approach on one fetch.
 */
const DEFAULT_CLEARANCE_TTL_MINUTES = MINUTES_PER_DAY

/** Wall-clock limit for one bridge detail lookup. */
const DEFAULT_CLEARANCE_FETCH_TIMEOUT_MS = 30_000

/**
 * How long, in milliseconds, after an attempt for a bridge began before that
 * bridge may be fetched again once the attempt failed.
 *
 * A failure is deliberately not cached as a clearance, so nothing else stops
 * the caller asking again on its next pass. That was harmless while a caller's
 * passes were a minute apart; the alarm evaluation now runs against the last
 * list result on every position fix, which is every ten to thirty seconds at
 * the default alarm radius, so an unresolvable bridge would otherwise put that
 * many requests a minute at the upstream for as long as it stayed in range.
 *
 * A minute is chosen because it is the rate the upstream already saw, so no
 * clearance resolves later than it did before evaluation moved onto the fix
 * rate. The window is measured from when the attempt started, not from when it
 * failed, so a fetch that burns its own timeout has already spent most of the
 * window and retries promptly rather than serving a second delay on top.
 */
export const FAILED_FETCH_RETRY_MS = MS_PER_MINUTE

/** Dependencies for {@link createBridgeClearanceResolver}. */
export interface ClearanceResolverDeps {
  /** Fetch a POI's detail view by id; the aggregate source routes it to the owning source. */
  getDetails: (id: string) => Promise<PoiDetailView>
  /** Plugin debug logger. */
  debug: (message: string) => void
  /**
   * How long, in minutes, a resolved clearance stays fresh before the resolver
   * re-fetches it on the next encounter. Defaults to
   * {@link DEFAULT_CLEARANCE_TTL_MINUTES}.
   */
  ttlMinutes?: number
  /** Clock source, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
  /**
   * Per-fetch timeout, in milliseconds. A fetch that does not resolve within
   * this window is abandoned so the id is released from `inFlight`, unblocking
   * future clearance resolution for that bridge. Defaults to
   * {@link DEFAULT_CLEARANCE_FETCH_TIMEOUT_MS}.
   */
  fetchTimeoutMs?: number
}

/** Public surface of the bridge clearance resolver. */
export interface BridgeClearanceResolver {
  /**
   * The bridge's vertical clearance in meters, or `null` when none is known
   * for this tick. May start an asynchronous detail fetch for an
   * ActiveCaptain bridge whose clearance is not yet cached.
   */
  clearanceMeters: (poi: PoiSummary) => number | null
  /**
   * Release the resolver at the end of a plugin run. Starts no further
   * fetches, drops the timeout timers still pending, discards whatever an
   * in-flight fetch resolves to, and empties the cache. Idempotent, and safe
   * to call while a fetch is outstanding.
   */
  close: () => void
}

/** A resolved ActiveCaptain clearance: a number, or `null` for "detail had none." */
interface CachedClearance {
  clearance: number | null
  /** Epoch ms (from the injected clock) at which this clearance was resolved. */
  resolvedAt: number
}

/** Create a bridge clearance resolver. */
export function createBridgeClearanceResolver (deps: ClearanceResolverDeps): BridgeClearanceResolver {
  const { getDetails, debug } = deps
  const ttlMs = (deps.ttlMinutes ?? DEFAULT_CLEARANCE_TTL_MINUTES) * MS_PER_MINUTE
  const now = deps.now ?? Date.now
  const fetchTimeoutMs =
    positiveFiniteNumber(deps.fetchTimeoutMs) ?? DEFAULT_CLEARANCE_FETCH_TIMEOUT_MS
  // Resolved ActiveCaptain clearances, keyed by POI id. Bounded by an LRU so a
  // long voyage past many bridges cannot grow the map without limit. A
  // CachedClearance wrapper lets a "detail carried no clearance" result be
  // cached as `{ clearance: null }`, which the LRU cannot store as a bare null,
  // and carries the resolve time so a stale entry can be re-fetched.
  const cache = new LRUCache<string, CachedClearance>({ max: MAX_POI_CACHE_ENTRIES })
  // Ids with a detail fetch in flight, so a burst of ticks cannot stack
  // duplicate fetches for the same bridge.
  const inFlight = new Set<string>()
  // When the last failed attempt for an id began, so a bridge that cannot be
  // resolved is retried on a bounded schedule rather than on every pass. Same
  // LRU bound as the clearance cache, for the same reason.
  const failedFetchStartedAt = new LRUCache<string, number>({ max: MAX_POI_CACHE_ENTRIES })
  // Pending per-fetch timeout timers, so close() can drop them rather than
  // leave one holding the event loop for the rest of its window.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  // Set by close(). Guards every post-close side effect: no new fetch starts,
  // and a fetch still in flight resolves into nothing.
  let closed = false

  function startFetch (id: string): void {
    inFlight.add(id)
    const startedAt = now()
    // Keep cache mutation after the race. If a timed-out request eventually
    // resolves, its late value must not overwrite a newer retry's result.
    let detailPromise: Promise<PoiDetailView>
    try {
      detailPromise = getDetails(id)
    } catch (error) {
      // The production dependency is async, but this also contains a
      // synchronously throwing test double or future adapter as another fetch
      // failure.
      detailPromise = Promise.reject(error)
    }
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Bridge clearance fetch timed out after ${fetchTimeoutMs} ms`))
      }, fetchTimeoutMs)
      timers.add(timer)
    })
    Promise.race([detailPromise, timeout])
      .then((detail) => {
        // A run that has been torn down keeps no state: this value belongs to
        // a configuration that is no longer live.
        if (closed) return
        cache.set(id, {
          clearance: toFiniteNumber(detail.verticalClearanceMeters),
          resolvedAt: now()
        })
        // A resolved bridge is no longer cooling off. The stamp is inert once
        // a clearance is cached, since that suppresses the fetch on its own,
        // but leaving it would outlive the clearance's own day-long entry.
        failedFetchStartedAt.delete(id)
      })
      .catch((error: unknown) => {
        // Transient failure: leave it uncached as a clearance so a later
        // encounter retries rather than reading "unknown" for the session.
        // Three bounds keep that from becoming a tight loop: the inFlight
        // dedupe set allows one fetch per bridge id at a time,
        // FAILED_FETCH_RETRY_MS allows one attempt per bridge per minute, and
        // getDetails brings its own retry and backoff. The caller's pass rate
        // is not one of them: an alarm evaluation runs on the position fix
        // rate, not the list request rate.
        failedFetchStartedAt.set(id, startedAt)
        debug(`Bridge clearance fetch failed for ${id}: ${String(error)}`)
      })
      .finally(() => {
        clearTimeout(timer)
        timers.delete(timer)
        inFlight.delete(id)
      })
  }

  function close (): void {
    closed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    inFlight.clear()
    cache.clear()
    failedFetchStartedAt.clear()
  }

  function clearanceMeters (poi: PoiSummary): number | null {
    const onSummary = toFiniteNumber(poi.verticalClearanceMeters)
    if (onSummary !== null) {
      return onSummary
    }
    // Only ActiveCaptain carries a clearance the summary lacked, and only in a
    // bridge's detail. Every other source either put the clearance on the
    // summary or has none to give.
    if (poi.source !== ACTIVE_CAPTAIN_SOURCE_ID || poi.type !== BRIDGE_POI_TYPE) {
      return null
    }
    const cached = cache.get(poi.id)
    const fresh = cached !== undefined && now() - cached.resolvedAt < ttlMs
    const lastFailedAt = failedFetchStartedAt.get(poi.id)
    const coolingOff = lastFailedAt !== undefined && now() - lastFailedAt < FAILED_FETCH_RETRY_MS
    // (Re-)fetch on a miss or a stale entry, unless one is already in flight,
    // the last attempt failed inside the retry window, or the run has been
    // torn down.
    if (!closed && !fresh && !coolingOff && !inFlight.has(poi.id)) {
      startFetch(poi.id)
    }
    // Serve a known clearance, even a stale one, while a refresh runs, so a
    // tick never regresses to "unknown" once the value is known; the next tick
    // returns the refreshed value.
    return cached?.clearance ?? null
  }

  return { clearanceMeters, close }
}
