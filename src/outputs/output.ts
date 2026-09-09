/**
 * Output contracts.
 *
 * An `OutputModule` is one consumer of POI data. `start()` returns an
 * `OutputHandle`; a position-driven output also attaches a
 * `PositionScanContributor` to that handle, and the shared position monitor
 * drives the per-tick scan from the union of every contributor. Adding a new
 * output means implementing `OutputModule` and registering it in
 * `src/index.ts`.
 */

import type { ServerAPI } from '@signalk/server-api'
import type { BridgeClearanceResolver } from './bridge-air-draft/bridge-clearance-resolver.js'
import type { PoiSource } from '../inputs/poi-source.js'
import type { PluginStatus } from '../status/plugin-status.js'
import type { Bbox, PluginConfig, PoiSummary, Position } from '../shared/types.js'

/**
 * A position-driven output's contribution to the shared per-tick scan. The
 * monitor calls `buildFetchBox` on every contributor to size one combined
 * list request, then calls `evaluate` on every contributor with the result.
 */
export interface PositionScanContributor {
  /**
   * POI types this contributor needs included in the per-tick list request.
   *
   * It is also the whole set this contributor may act on: a contributor that
   * declares {@link alarmRadiusMeters} is replayed against a copy of the last
   * result narrowed to the declared types, so a point of a type left out here
   * reaches `evaluate` on the tick and not between ticks. Declaring the types
   * once, beside the filter the output applies, is what keeps the two honest.
   */
  readonly poiTypes: readonly string[]
  /**
   * The alarm radius, in meters, of the circle this contributor draws around
   * each point of interest. Present on a contributor whose alarm fires only
   * while the vessel is inside that circle, absent on a look-ahead one.
   *
   * Declaring it opts the contributor into evaluation between list requests:
   * a circle around a point is a window the vessel can pass straight through
   * between two list requests, so the monitor re-evaluates a declaring
   * contributor against the last fetched list on every position fix, and
   * sizes its own sampling from the tightest declared radius. A look-ahead
   * contributor (the route-corridor scan flags a point up to ten miles before
   * the vessel reaches it) has no such window and omits the field.
   *
   * A declaring contributor must size its fetch box with
   * `vesselScanRadiusMeters`, since the monitor derives from that helper how
   * far the vessel may travel before a refetch is due.
   */
  readonly alarmRadiusMeters?: number
  /**
   * Optional hook for outputs whose inputs can change without a position
   * delta. The monitor supplies a callback that requests one immediate scan;
   * the output calls it after committing such a change.
   */
  setScanRequester?: (requestScan: () => void) => void
  /**
   * Build this contributor's fetch bounding box for the tick, or `null` when
   * it needs nothing fetched this tick. `tickPosition` is the throttled tick
   * position.
   */
  buildFetchBox: (tickPosition: Position) => Bbox | null
  /**
   * Evaluate the tick. `pois` is the combined list result, or `[]` when no
   * contributor produced a fetch box. `vesselPosition` is the latest fix.
   * `listFetchedAt` is when the request behind `pois` landed, which an alarm
   * output runs its retention window on: a replay reports the original
   * request's time, so re-evaluating one result cannot make it look freshly
   * reported however many times it runs.
   *
   * Called on every tick so an output can clear stale alarms, and, for a
   * contributor that declares {@link alarmRadiusMeters}, again between list
   * requests against the last result. A between-request call hands back the
   * same array the last request produced, so an implementation must treat
   * `pois` as read-only and must be safe to run repeatedly on one result.
   */
  evaluate: (vesselPosition: Position, pois: PoiSummary[], listFetchedAt: number) => void
}

/** Handle returned by {@link OutputModule.start}; the plugin stops it on teardown. */
export interface OutputHandle {
  /** Tear the output down. Idempotent. */
  stop: () => void
  /**
   * Present only on position-driven outputs. The plugin collects these and
   * builds the shared position monitor from them.
   */
  positionScan?: PositionScanContributor
}

/** Dependencies handed to an {@link OutputModule} when it starts. */
export interface OutputContext {
  /** The SignalK app. */
  app: ServerAPI
  /** The resolved plugin configuration. */
  config: PluginConfig
  /** The aggregate POI source. */
  pois: PoiSource
  /** The status recorder. */
  status: PluginStatus
  /**
   * The run's shared bridge-clearance resolver, built once per start by the
   * plugin shell. The bridge air-draft and route-hazard outputs both consume
   * it, so the same bridge resolves once (one LRU, one in-flight dedupe set)
   * when both are enabled, and the resolver's lifetime is visibly tied to
   * the start that assembled this context.
   */
  bridgeClearanceResolver: BridgeClearanceResolver
}

/** A registrable consumer of POI data. */
export interface OutputModule {
  /** Stable id of the output, e.g. `notes-resource`. */
  readonly id: string
  /** Human-readable name, for logs. */
  readonly name: string
  /** JSON Schema `properties` fragment merged into the plugin config schema. */
  readonly configSchema: Record<string, unknown>
  /** True when the current configuration enables this output. */
  isEnabled: (config: PluginConfig) => boolean
  /** Start the output. Called once per plugin start, only when enabled. */
  start: (context: OutputContext) => OutputHandle
}
