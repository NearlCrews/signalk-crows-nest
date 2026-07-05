/**
 * Input contracts.
 *
 * A `PoiSource` is one upstream provider of points of interest. An
 * `InputModule` packages a source for registration: it carries the id, the
 * config-schema fragment, an enablement check, and a factory. Adding a new POI
 * data source means implementing these two interfaces and registering the
 * module in `src/index.ts`.
 */

import type { ServerAPI } from '@signalk/server-api'
import { bboxContainsPoint } from '../geo/position-utilities.js'
import type { PluginStatus } from '../status/plugin-status.js'
import type { Bbox, PluginConfig, PoiDetailView, PoiSummary, Position } from '../shared/types.js'

/** One upstream provider of points of interest. */
export interface PoiSource {
  /** Stable id of the source, e.g. `activecaptain`. */
  readonly id: string
  /**
   * List point-of-interest summaries within a bounding box, restricted to the
   * comma-separated, source-specific `poiTypes` filter. Rejects on failure.
   */
  listPointsOfInterest: (bbox: Bbox, poiTypes: string) => Promise<PoiSummary[]>
  /**
   * Fetch one point of interest by id as a fully rendered, source-agnostic
   * detail view. Rejects on failure.
   */
  getDetails: (id: string) => Promise<PoiDetailView>
  /** Number of detail entries currently cached, for the status snapshot. */
  cacheSize: () => number
  /** Abort in-flight work and release resources. Called on plugin stop. */
  close: () => void
}

/** Dependencies handed to an {@link InputModule} when it builds its source. */
export interface InputContext {
  /** The SignalK app. */
  app: ServerAPI
  /** The resolved plugin configuration. */
  config: PluginConfig
  /** The status recorder; a source wires API outcomes into it. */
  status: PluginStatus
  /** Absolute path to the plugin data directory, for on-disk caches. */
  dataDir: string
  /**
   * The most recent vessel position known to the plugin, or undefined when
   * no fix has arrived yet. A US-only input reads this to skip outbound
   * HTTP when the vessel is outside US waters. The reader is a closure so
   * the input always sees the latest fix, not a stale one captured at
   * construction time.
   */
  getCurrentPosition: () => Position | undefined
}

/** A registrable POI data source. */
export interface InputModule {
  /** Stable id of the input, matching the `PoiSource.id` it creates. */
  readonly id: string
  /** Human-readable name, for logs. */
  readonly name: string
  /**
   * JSON Schema `properties` fragment merged into the plugin config schema.
   * Keyed by config property name.
   */
  readonly configSchema: Record<string, unknown>
  /** True when the current configuration enables this input. */
  isEnabled: (config: PluginConfig) => boolean
  /**
   * True when this non-base input should dedupe its POIs against the
   * ActiveCaptain base layer. Absent on the base input and on any input that
   * has no dedupe toggle; present on a non-base input that offers one.
   */
  isDedupeEnabled?: (config: PluginConfig) => boolean
  /**
   * The merge radius (in meters) this input wants the dedupe pass to use
   * when matching its POIs against the ActiveCaptain base. Absent for the
   * base input and for any input that does not surface a per-source radius
   * field; present for each non-base input that does. The registry passes
   * a per-source radius map to {@link dedupeAgainstBase} built from this
   * method, so a tight USCG-against-AC merge can coexist with a looser
   * OpenSeaMap-against-AC merge in the same run.
   */
  dedupeRadiusMeters?: (config: PluginConfig) => number | null | undefined
  /** Build the source. Called once per plugin start. */
  createSource: (context: InputContext) => PoiSource
}

/**
 * Run a detail fetch with the shared reachability-recording policy: a
 * transport failure records a per-source error, while a normal upstream
 * answer records a detail success even when the feature turns out to be
 * absent or unusable, because an API answering normally is not a
 * reachability failure. The OpenSeaMap and NOAA ENC sources both wrap their
 * client call in this helper (mirroring the ActiveCaptain 404 handling), so
 * the miss-vs-outage policy lives once: a not-found thrown by the caller
 * AFTER this resolves cannot flip the status row to unreachable.
 */
export async function fetchDetailRecorded<T> (
  status: PluginStatus,
  sourceId: string,
  fetchUpstream: () => Promise<T>
): Promise<T> {
  let result: T
  try {
    result = await fetchUpstream()
  } catch (error) {
    status.recordError(sourceId, `Detail request failed: ${String(error)}`)
    throw error
  }
  status.recordDetailSuccess(sourceId)
  return result
}

/** The outcome of a list fetch that may fall back to stale offline data. */
export type ListFetchOutcome<T> =
  | { kind: 'fresh', value: T }
  | { kind: 'stale', summaries: PoiSummary[] }

/**
 * Run an upstream list fetch with the shared offline-fallback policy: on a
 * rejection (a cold cache miss offline, say) the caller's `rebuildStale`
 * closure rebuilds summaries from its hydrated detail cache so previously
 * visited areas still show their markers after a restart. `recordStaleServe`
 * keeps the status honest: `apiReachable` is set false and the aggregate does
 * not count the serve as a reachable list fetch. With no stale data to show,
 * the original error propagates instead. The OpenSeaMap and NOAA ENC sources
 * both wrap their bbox fetch in this helper, so the fallback control flow
 * lives once; only the per-source summary rebuild varies.
 */
export async function fetchListWithOfflineFallback<T> (
  status: PluginStatus,
  sourceId: string,
  outageReason: string,
  fetchUpstream: () => Promise<T>,
  rebuildStale: () => PoiSummary[]
): Promise<ListFetchOutcome<T>> {
  try {
    return { kind: 'fresh', value: await fetchUpstream() }
  } catch (error) {
    const summaries = rebuildStale()
    if (summaries.length === 0) throw error
    status.recordStaleServe?.(sourceId, outageReason)
    return { kind: 'stale', summaries }
  }
}

/**
 * Rebuild summaries from a hydrated detail cache for a bounding box, the
 * per-source half of the offline fallback. The position is read through the
 * cheap `positionOf` accessor BEFORE the full summary is built, so an
 * out-of-box record costs no summary construction; `toSummary` may still
 * return null for a record too malformed to list.
 */
export function staleSummariesWithinBbox<V> (
  values: Iterable<V>,
  bbox: Bbox,
  positionOf: (value: V) => Position | undefined,
  toSummary: (value: V) => PoiSummary | null
): PoiSummary[] {
  const summaries: PoiSummary[] = []
  for (const value of values) {
    const position = positionOf(value)
    if (position === undefined ||
      !bboxContainsPoint(bbox, position.longitude, position.latitude)) {
      continue
    }
    const summary = toSummary(value)
    if (summary === null) continue
    summaries.push(summary)
  }
  return summaries
}
