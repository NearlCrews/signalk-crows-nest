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

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CourseInfo } from '@signalk/server-api'
import type { PoiDetails } from '../src/inputs/active-captain/active-captain-types.js'
import type { NotificationTrackerApp } from '../src/shared/notification-tracker.js'
import type { PoiSummary, PoiType, Position } from '../src/shared/types.js'
import type { PluginStatus } from '../src/status/plugin-status.js'
import type { StatusSnapshot } from '../src/status/status-types.js'

/**
 * Run `body` against a fresh temp directory named with `prefix`, removing the
 * directory afterwards even when the body throws. Used by the disk-store
 * tests that exercise real filesystem persistence.
 */
export async function withTempDir (prefix: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

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

/** A stub {@link PluginStatus} recorder and the events it captured. */
export interface StubStatus {
  /** Every recorded outcome as an `event:source[:detail]` string, in order. */
  events: string[]
  /** The recorder the source under test is driven with. */
  status: PluginStatus
}

/**
 * Build a stub {@link PluginStatus} that records each outcome as an
 * `event:source[:detail]` string, so a source-adapter test can assert the
 * request outcomes it drove. `wasListFetchSuppressed` reads the per-source
 * suppression that `recordSkipped` and `recordStaleServe` raise, matching
 * production plugin-status.ts (though the stub's read is persistent membership
 * rather than consume-on-read). `snapshot` returns an empty-but-valid
 * {@link StatusSnapshot}; the at-runtime sources under test do not read it, so
 * it is present only to satisfy the interface.
 */
export function createStubStatus (): StubStatus {
  const events: string[] = []
  const suppressed = new Set<string>()
  const status: PluginStatus = {
    recordListFetch: (source, count) => { events.push(`list:${source}:${count}`); suppressed.delete(source) },
    recordDetailSuccess: (source) => { events.push(`detail-ok:${source}`) },
    recordError: (source, message) => { events.push(`error:${source}:${message}`); suppressed.delete(source) },
    recordSkipped: (source, reason) => { events.push(`skipped:${source}:${reason}`); suppressed.add(source) },
    recordStaleServe: (source, reason) => { events.push(`stale:${source}:${reason}`); suppressed.add(source) },
    wasListFetchSuppressed: (source) => suppressed.has(source),
    snapshot: (): StatusSnapshot => ({ sources: [], cachedPoiCount: 0, recentErrors: [], startedAt: '' })
  }
  return { events, status }
}

/** One request a {@link StubServer} recorded. */
export interface StubServerRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

/** A running {@link startStubServer} instance and the requests it received. */
export interface StubServer {
  /** Base URL the server listens on, e.g. `http://127.0.0.1:54321`. */
  url: string
  /** Every request received, in order, captured before the handler runs. */
  requests: StubServerRequest[]
  /** Stop the server, resolving once it has closed. */
  close: () => Promise<void>
}

/**
 * Start a `node:http` server on an ephemeral loopback port, recording each
 * request's method, url, and headers before handing it to `handler`. The
 * one-shot HTTP transport the raw-client sources use speaks real sockets rather
 * than a mockable global fetch, so their client tests need a real server; this
 * owns the listen, address-to-url, request recording, and close plumbing they
 * all shared, leaving each test only its own response behavior.
 */
export async function startStubServer (
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<StubServer> {
  const requests: StubServerRequest[] = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers })
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error != null ? reject(error) : resolve()))
    })
  }
}
