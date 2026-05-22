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
import type { PoiSource } from '../inputs/poi-source.js'
import type { PluginStatus } from '../status/plugin-status.js'
import type { Bbox, PluginConfig, PoiSummary, Position } from '../shared/types.js'

/**
 * A position-driven output's contribution to the shared per-tick scan. The
 * monitor calls `buildFetchBox` on every contributor to size one combined
 * list request, then calls `evaluate` on every contributor with the result.
 */
export interface PositionScanContributor {
  /** POI types this contributor needs included in the per-tick list request. */
  readonly poiTypes: readonly string[]
  /**
   * Build this contributor's fetch bounding box for the tick, or `null` when
   * it needs nothing fetched this tick. `tickPosition` is the throttled tick
   * position.
   */
  buildFetchBox: (tickPosition: Position) => Bbox | null
  /**
   * Evaluate the tick. `pois` is the combined list result, or `[]` when no
   * contributor produced a fetch box. `vesselPosition` is the latest fix.
   * Called on every tick so an output can clear stale alarms.
   */
  evaluate: (vesselPosition: Position, pois: PoiSummary[]) => void
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
