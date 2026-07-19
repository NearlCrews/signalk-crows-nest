/**
 * Shared raise/clear bookkeeping for the plugin's alarm outputs.
 *
 * Both the proximity-alarm and the route-hazard outputs keep a map of
 * currently-alarming points of interest and have to clear each one with a
 * single `state: 'normal'` notification at exit and a full sweep at plugin
 * stop. The entry-and-refresh logic differs between the two outputs (the
 * proximity output applies hysteresis, the route output also refreshes the
 * message when the distance or ETA changes), but the clear half is the same
 * shape on both, so this module owns it.
 *
 * A caller creates a tracker with the notification path prefix and a
 * `buildClearValue` callback, then drives entries with `set` / `clear`. The
 * raise step lives in the caller because that is where the two outputs
 * legitimately disagree.
 */

import {
  emitNotification,
  sanitizePoiId,
  type NotificationEmitterApp,
  type NotificationValue
} from './notification-path.js'

/** The slice of the SignalK app a tracker needs for emit and debug logging. */
export interface NotificationTrackerApp extends NotificationEmitterApp {
  debug: (message: string) => void
}

/** Inputs for {@link createNotificationTracker}. */
export interface NotificationTrackerConfig<T> {
  app: NotificationTrackerApp
  /** Notification path prefix, completed with the encoded POI id suffix. */
  pathPrefix: string
  /**
   * Optional `$source` suffix appended to the plugin id, so the clear
   * delta shares the per-output `$source` brand the raise carries.
   */
  sourceSuffix?: string
  /**
   * Build the `state: 'normal'` notification value for an entry being
   * cleared. `raisedAt` is the alarm episode's start time (stamped by the
   * tracker on the first `set`), so a clear delta's `createdAt` reports when
   * the episode began rather than resetting to the clear time.
   */
  buildClearValue: (entry: T, raisedAt: string) => NotificationValue
  /** Optional debug log emitted on each clear, given the POI id and entry. */
  describeClear?: (poiId: string, entry: T) => string
}

/** Public surface of the tracker. */
export interface NotificationTracker<T> {
  /** True when the POI id is currently in the alarm state. */
  has: (poiId: string) => boolean
  /** The active entry for `poiId`, or `undefined` when none. */
  get: (poiId: string) => T | undefined
  /**
   * Mark `poiId` as currently alarming and store its entry. Returns the
   * alarm episode's `raisedAt` ISO timestamp: stamped on the first `set` of
   * an episode and preserved across overwrites (a message refresh), so the
   * caller puts the same `createdAt` on every delta of the episode. Episode
   * time is a tracker invariant, not a per-caller convention, so a new alarm
   * output cannot accidentally reset it.
   */
  set: (poiId: string, entry: T) => string
  /**
   * Clear every active entry whose POI id is not in `activeIds`. The ids are
   * encoded into the tracker's key space before the comparison, so a caller
   * can pass raw POI ids and the kept set still matches the wire identities. A
   * raw-vs-sanitized key-space mismatch would otherwise clear and re-raise a
   * still-active alarm every tick (alarm chatter on a safety alarm).
   */
  clearStale: (activeIds: Iterable<string>) => void
  /** Clear every active entry. Called on plugin stop. */
  clearAll: () => void
}

/**
 * Create an alarm tracker bound to the given app and notification path.
 *
 * The tracker keys its internal map by the encoded POI id suffix, the same value
 * `emitNotification` puts on the wire. Keying by the raw id would let two
 * callers accidentally disagree about the identity they use for active-state
 * bookkeeping and the identity emitted on the wire.
 */
export function createNotificationTracker<T> (
  config: NotificationTrackerConfig<T>
): NotificationTracker<T> {
  const { app, pathPrefix, sourceSuffix, buildClearValue, describeClear } = config
  const active = new Map<string, { entry: T, poiId: string, raisedAt: string }>()

  // Clear one alarming entry: emit its `normal` notification, drop it from
  // the active set, and optionally log. A no-op when `safeId` is not active.
  // Internal only; the callers drive clears through clearStale and clearAll.
  function clear (safeId: string): void {
    const record = active.get(safeId)
    if (record === undefined) {
      return
    }
    // Keep the raw id with the record. An encoded suffix deliberately contains
    // the controlled `escaped.` separator, so passing that suffix back through
    // sanitizePoiId would correctly treat it as a raw unsafe id and encode it
    // again. Emitting the original id avoids that double encoding.
    emitNotification(app, pathPrefix, record.poiId, buildClearValue(record.entry, record.raisedAt), sourceSuffix)
    active.delete(safeId)
    if (describeClear !== undefined) {
      app.debug(describeClear(record.poiId, record.entry))
    }
  }

  function clearStale (activeIds: Iterable<string>): void {
    const keep = new Set<string>()
    for (const id of activeIds) {
      keep.add(sanitizePoiId(id))
    }
    // Snapshot the keys first: clear() deletes from the map as it iterates.
    for (const safeId of [...active.keys()]) {
      if (!keep.has(safeId)) {
        clear(safeId)
      }
    }
  }

  function clearAll (): void {
    // Snapshot the keys first: clear() deletes from the map as it iterates.
    for (const safeId of [...active.keys()]) {
      clear(safeId)
    }
  }

  return {
    has: (poiId) => active.has(sanitizePoiId(poiId)),
    get: (poiId) => active.get(sanitizePoiId(poiId))?.entry,
    set: (poiId, entry) => {
      const safeId = sanitizePoiId(poiId)
      // Preserve the episode start across an overwrite (a message refresh);
      // stamp it only when the id enters the alarm state.
      const raisedAt = active.get(safeId)?.raisedAt ?? new Date().toISOString()
      active.set(safeId, { entry, poiId, raisedAt })
      return raisedAt
    },
    clearStale,
    clearAll
  }
}
