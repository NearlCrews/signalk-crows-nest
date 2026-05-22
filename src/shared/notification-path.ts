/**
 * Helpers for building SignalK notification deltas.
 *
 * A notification path is dot-delimited, so any dynamic segment embedded in one
 * must be free of characters that would silently fork the path. The proximity
 * and route-hazard alarm outputs both embed a point-of-interest id, so the
 * sanitizer that makes an id path-safe lives here and is shared by both. Both
 * outputs also build the same notification delta around that path, so the
 * emitter that wraps a value into that delta is shared here too.
 */

import type { Delta, Path, SourceRef, Timestamp } from '@signalk/server-api'
import { PLUGIN_ID } from './plugin-id.js'

/**
 * Common shape of a notification value the plugin's alarm outputs emit. Each
 * output narrows the `state` union to the severities it raises (the proximity
 * alarm uses `alarm`, the route-hazard scan uses `warn`), but the cleared
 * state, the method array, the human-readable message, and the timestamp are
 * the same across both outputs. This is a superset of the SignalK
 * `Notification` shape: it also carries the `timestamp`, per the Tier 1 design.
 */
export interface NotificationValue {
  state: 'alarm' | 'warn' | 'normal'
  method: Array<'visual' | 'sound'>
  message: string
  timestamp: string
}

/**
 * Make a POI id safe to embed in a dot-delimited SignalK path. ActiveCaptain
 * ids are numeric, but the alarm outputs' `evaluate` is a public entry point:
 * a stray `.` would silently fork the notification onto a different path, so
 * any character outside `[A-Za-z0-9_-]` is replaced.
 */
export function sanitizePoiId (poiId: string): string {
  return poiId.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * The slice of the SignalK app the notification emitter needs. The real
 * `ServerAPI` satisfies this structurally, so the plugin entrypoint passes
 * `app` directly; tests pass a small stub. `handleMessage` is narrowed to the
 * two-argument form (the optional `skVersion` argument is unused: the
 * notification path is v1).
 */
export interface NotificationEmitterApp {
  handleMessage: (id: string, delta: Partial<Delta>) => void
}

/**
 * Emit a SignalK notification delta for a point of interest.
 *
 * The proximity and route-hazard alarm outputs build the same delta: a single
 * update in the `vessels.self` context (the default when a delta carries no
 * context), carrying the plugin id as `$source`, the value's own `timestamp`,
 * and one path/value pair. The path is `pathPrefix` completed with the
 * path-safe POI id, and `value` is the per-output notification object.
 */
export function emitNotification (
  app: NotificationEmitterApp,
  pathPrefix: string,
  poiId: string,
  value: NotificationValue
): void {
  app.handleMessage(PLUGIN_ID, {
    updates: [{
      $source: PLUGIN_ID as SourceRef,
      timestamp: value.timestamp as Timestamp,
      values: [{
        path: `${pathPrefix}${sanitizePoiId(poiId)}` as Path,
        value
      }]
    }]
  })
}
