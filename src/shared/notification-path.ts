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

import { Buffer } from 'node:buffer'
import type { Delta, Path, SourceRef, Timestamp } from '@signalk/server-api'
import { PLUGIN_ID } from './plugin-id.js'

/**
 * Common shape of a notification value the plugin's alarm outputs emit. Each
 * output narrows the `state` union to the severities it raises (the proximity
 * alarm uses `alarm`, the route-hazard scan uses `warn`), but the cleared
 * state, the method array, the human-readable message, and the
 * notification-creation timestamp are the same across both outputs.
 *
 * The optional `createdAt` field matches the SignalK Notification spec's
 * optional `createdAt`, so a strict server-side validator does not reject
 * the value as having an unknown field. The wire `timestamp` on the outer
 * Update is set from this value too, so a consumer that reads the standard
 * Update.timestamp gets the same instant.
 */
export interface NotificationValue {
  state: 'alarm' | 'warn' | 'normal'
  method: Array<'visual' | 'sound'>
  message: string
  createdAt: string
}

/**
 * Make a POI id safe to append to a dot-delimited SignalK path. IDs made only
 * of `[A-Za-z0-9_-]` stay unchanged, preserving existing notification paths.
 * Every other id is encoded as UTF-8 base64url beneath the controlled
 * `escaped` segment. The controlled dot keeps encoded values disjoint from
 * every unchanged safe id, while base64url preserves distinct unsafe ids
 * without introducing path-breaking characters.
 *
 * Base64url for an empty string is empty, which would create an empty path
 * segment. The reserved `_` payload represents only the empty id. A non-empty
 * byte sequence cannot have a one-character base64url representation, so the
 * marker cannot collide with an encoded non-empty id.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const ESCAPED_ID_PREFIX = 'escaped.'
const EMPTY_ID_PAYLOAD = '_'

export function sanitizePoiId (poiId: string): string {
  if (SAFE_ID.test(poiId)) {
    return poiId
  }
  const payload = poiId.length === 0
    ? EMPTY_ID_PAYLOAD
    : Buffer.from(poiId, 'utf8').toString('base64url')
  return `${ESCAPED_ID_PREFIX}${payload}`
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
 * path-safe POI id suffix, and `value` is the per-output notification object.
 *
 * `sourceSuffix` differentiates the `$source` per alarm output, so consumers
 * filtering by `$source` can tell a proximity alarm from a route-corridor
 * one even though both come from this plugin. The suffix is joined to the
 * plugin id with a dot, matching the pattern in-tree SignalK plugins use
 * to brand sub-features of one plugin (e.g. `signalk-anchoralarm.alarm`).
 * An absent or empty suffix yields the plain plugin id with no trailing
 * dot, so `''` never produces `signalk-crows-nest.`.
 */
export function emitNotification (
  app: NotificationEmitterApp,
  pathPrefix: string,
  poiId: string,
  value: NotificationValue,
  sourceSuffix?: string,
  now: () => Date = () => new Date()
): void {
  const $source = (sourceSuffix === undefined || sourceSuffix === ''
    ? PLUGIN_ID
    : `${PLUGIN_ID}.${sourceSuffix}`) as SourceRef
  app.handleMessage(PLUGIN_ID, {
    updates: [{
      $source,
      timestamp: now().toISOString() as Timestamp,
      values: [{
        path: `${pathPrefix}${sanitizePoiId(poiId)}` as Path,
        value
      }]
    }]
  })
}
