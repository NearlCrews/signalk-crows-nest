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
 *   is cached, so a later tick returns it. The scan box is far wider than the
 *   alarm radius, so a one-tick lag before an ActiveCaptain clearance is known
 *   never costs a real alarm.
 * - Any other bridge with no clearance resolves to `null` with no fetch: no
 *   other source exposes a clearance the summary did not already carry.
 *
 * `null` from {@link BridgeClearanceResolver.clearanceMeters} means "no usable
 * clearance right now," which the callers treat as "do not warn." A transient
 * `getDetails` failure is not cached, so the bridge is retried on a later
 * encounter rather than being pinned to "unknown" for the session.
 */

import { LRUCache } from 'lru-cache'
import { ACTIVE_CAPTAIN_SOURCE_ID } from '../../shared/source-ids.js'
import { MAX_POI_CACHE_ENTRIES } from '../../shared/cache.js'
import { toFiniteNumber } from '../../shared/numbers.js'
import type { PoiDetailView, PoiSummary } from '../../shared/types.js'

/** Dependencies for {@link createBridgeClearanceResolver}. */
export interface ClearanceResolverDeps {
  /** Fetch a POI's detail view by id; the aggregate source routes it to the owning source. */
  getDetails: (id: string) => Promise<PoiDetailView>
  /** Plugin debug logger. */
  debug: (message: string) => void
}

/** Public surface of the bridge clearance resolver. */
export interface BridgeClearanceResolver {
  /**
   * The bridge's vertical clearance in meters, or `null` when none is known
   * for this tick. May start an asynchronous detail fetch for an
   * ActiveCaptain bridge whose clearance is not yet cached.
   */
  clearanceMeters: (poi: PoiSummary) => number | null
}

/** A resolved ActiveCaptain clearance: a number, or `null` for "detail had none." */
interface CachedClearance {
  clearance: number | null
}

/** Create a bridge clearance resolver. */
export function createBridgeClearanceResolver (deps: ClearanceResolverDeps): BridgeClearanceResolver {
  const { getDetails, debug } = deps
  // Resolved ActiveCaptain clearances, keyed by POI id. Bounded by an LRU so a
  // long voyage past many bridges cannot grow the map without limit. A
  // CachedClearance wrapper lets a "detail carried no clearance" result be
  // cached as `{ clearance: null }`, which the LRU cannot store as a bare null.
  const cache = new LRUCache<string, CachedClearance>({ max: MAX_POI_CACHE_ENTRIES })
  // Ids with a detail fetch in flight, so a burst of ticks cannot stack
  // duplicate fetches for the same bridge.
  const inFlight = new Set<string>()

  function startFetch (id: string): void {
    inFlight.add(id)
    getDetails(id)
      .then((detail) => {
        cache.set(id, { clearance: toFiniteNumber(detail.verticalClearanceMeters) })
      })
      .catch((error: unknown) => {
        // Transient failure: leave it uncached so a later encounter retries.
        // getDetails has its own retry/backoff and the monitor ticks at most
        // once a minute, so this cannot become a tight loop.
        debug(`Bridge clearance fetch failed for ${id}: ${String(error)}`)
      })
      .finally(() => {
        inFlight.delete(id)
      })
  }

  function clearanceMeters (poi: PoiSummary): number | null {
    const onSummary = toFiniteNumber(poi.verticalClearanceMeters)
    if (onSummary !== null) {
      return onSummary
    }
    // Only ActiveCaptain carries a clearance the summary lacked, and only in a
    // bridge's detail. Every other source either put the clearance on the
    // summary or has none to give.
    if (poi.source !== ACTIVE_CAPTAIN_SOURCE_ID || poi.type !== 'Bridge') {
      return null
    }
    const cached = cache.get(poi.id)
    if (cached !== undefined) {
      return cached.clearance
    }
    if (!inFlight.has(poi.id)) {
      startFetch(poi.id)
    }
    return null
  }

  return { clearanceMeters }
}
