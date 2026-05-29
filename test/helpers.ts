/**
 * Shared test helpers.
 *
 * Several test files in this suite built their own variants of the same three
 * helpers: a stub SignalK app that captures every notification delta, a north
 * offset on the equator that places a fixture at a known distance from the
 * origin, and a `PoiSummary` builder with the ActiveCaptain url/attribution
 * defaults. They are consolidated here so a tweak to the captured shape, the
 * meters-per-degree constant, or the default summary attribution lands in one
 * place rather than three.
 */

import type { NotificationTrackerApp } from '../src/shared/notification-tracker.js'
import type { PoiSummary, PoiType, Position } from '../src/shared/types.js'

/** Shape of the notification value recorded by {@link createCapturingApp}. */
export interface CapturedNotification {
  path: string
  value: { state: string, method: string[], message: string, createdAt: string }
}

/**
 * Build a stub `NotificationTrackerApp` that records every notification delta
 * `handleMessage` sees, flattened into a list of `{ path, value }` entries.
 * `debug` is silenced. The same shape satisfies the alarm modules' `AlarmApp`
 * and `RouteAlarmApp` aliases.
 */
export function createCapturingApp (): { app: NotificationTrackerApp, captured: CapturedNotification[] } {
  const captured: CapturedNotification[] = []
  const app: NotificationTrackerApp = {
    handleMessage: (_id, delta) => {
      const update = delta.updates?.[0]
      if (update !== undefined && 'values' in update) {
        for (const pathValue of update.values) {
          captured.push({
            path: String(pathValue.path),
            value: pathValue.value as CapturedNotification['value']
          })
        }
      }
    },
    debug: () => {}
  }
  return { app, captured }
}

/**
 * A position roughly `metersNorth` meters north of the origin. One degree of
 * latitude is about 111_320 m on the spherical Earth this plugin uses, which is
 * precise enough to place test fixtures comfortably inside or outside a radius.
 */
export function northOfOrigin (metersNorth: number): Position {
  return { latitude: metersNorth / 111_320, longitude: 0 }
}

/**
 * Build a `PoiSummary` of the given type at the given position, with the
 * ActiveCaptain url and attribution defaults the fixtures need.
 */
export function poiSummary (id: string, type: PoiType, name: string, position: Position): PoiSummary {
  return {
    id,
    type,
    position,
    name,
    source: 'activecaptain',
    url: `https://activecaptain.garmin.com/en-US/pois/${id}`,
    attribution: 'Data from Garmin ActiveCaptain',
    // A neutral registered Freeboard icon: the fixtures that build through this
    // helper exercise alarm and dedupe behavior, not icon mapping, so they do
    // not assert on it.
    skIcon: 'notice-to-mariners'
  }
}
