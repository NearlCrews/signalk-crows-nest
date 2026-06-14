/**
 * Shared test helpers.
 *
 * Several test files in this suite built their own variants of the same
 * helpers: a stub SignalK app that captures every notification delta, a north
 * offset on the equator that places a fixture at a known distance from the
 * origin, a `PoiSummary` builder with the ActiveCaptain url/attribution
 * defaults, a microtask flush, a minimal `PoiDetails` builder, a silent
 * logger plus JSON `Response` builder for the HTTP client tests, and the
 * Course API stubs. They are consolidated here so a tweak to any one shape
 * lands in one place rather than in per-file copies.
 */

import type { CourseInfo } from '@signalk/server-api'
import type { PoiDetails } from '../src/inputs/active-captain/active-captain-types.js'
import type { NotificationTrackerApp } from '../src/shared/notification-tracker.js'
import type { PoiSummary, PoiType, Position } from '../src/shared/types.js'

/**
 * Resolve once the pending microtasks have drained, so a fire-and-forget
 * background step (a cache revalidation, a route resolution, an awaited scan)
 * has settled before the test reads its effect.
 */
export function flush (): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/** A logger that discards output, keeping test runs quiet. */
export const silentLog = { debug: (): void => {}, error: (): void => {} }

/** Build a JSON Response with the given status and optional headers. */
export function jsonResponse (body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/** The fetch calls a {@link withMockFetch} run records: the count, the last init, and every url. */
export interface MockFetchCalls {
  count: number
  lastInit?: RequestInit
  urls: string[]
}

/**
 * Swap in a stubbed global fetch for the duration of `fn`, then restore it. The
 * stub records every call's init and url so a test can assert on the request.
 * The handler receives the zero-based call index, so a multi-call test can
 * answer each request differently.
 */
export async function withMockFetch (
  handler: (callIndex: number, init?: RequestInit, url?: string) => Response | Promise<Response>,
  fn: (calls: MockFetchCalls) => Promise<void>
): Promise<void> {
  const original = globalThis.fetch
  const calls: MockFetchCalls = { count: 0, urls: [] }
  globalThis.fetch = (async (url: unknown, init?: RequestInit): Promise<Response> => {
    const callIndex = calls.count
    calls.count++
    calls.lastInit = init
    calls.urls.push(String(url))
    return handler(callIndex, init, String(url))
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = original
  }
}

/** Build a minimal but valid PoiDetails record for the given id. */
export function makeDetails (id: string): PoiDetails {
  return {
    pointOfInterest: {
      id: Number(id),
      name: `POI ${id}`,
      poiType: 'Marina',
      mapLocation: { latitude: 0, longitude: 0 },
      dateLastModified: '2024-01-01T00:00:00Z'
    }
  }
}

/** Build a course with no active route (a point destination, or nothing). */
export function courseWithoutRoute (): CourseInfo {
  return {
    startTime: null,
    targetArrivalTime: null,
    arrivalCircle: 0,
    activeRoute: null,
    nextPoint: null,
    previousPoint: null
  } as CourseInfo
}

/** Wrap GeoJSON coordinates (longitude first) in a minimal route resource. */
export function routeResource (coordinates: unknown): object {
  return {
    name: 'Test route',
    feature: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates }
    }
  }
}

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
