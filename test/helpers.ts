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
 * request outcomes it drove. `snapshot` returns an empty-but-valid
 * {@link StatusSnapshot}; the at-runtime sources under test do not read it, so
 * it is present only to satisfy the interface.
 */
export function createStubStatus (): StubStatus {
  const events: string[] = []
  const status: PluginStatus = {
    recordListFetch: (source, count) => { events.push(`list:${source}:${count}`) },
    recordDetailSuccess: (source) => { events.push(`detail-ok:${source}`) },
    recordError: (source, message) => { events.push(`error:${source}:${message}`) },
    recordSkipped: (source, reason) => { events.push(`skipped:${source}:${reason}`) },
    recordStaleServe: (source, reason) => { events.push(`stale:${source}:${reason}`) },
    unreachableSources: () => [],
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
/**
 * Start a {@link startStubServer} that answers every request with `body` as
 * JSON, carrying the conditional-GET validators a real 200 from these feeds
 * does. Each raw-client test grew its own copy of this to drive one wire shape
 * through a client that speaks real sockets; the validator values are fixture
 * furniture rather than anything a caller asserts on, so they live here too.
 */
export function startJsonServer (body: unknown): Promise<StubServer> {
  return startStubServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Last-Modified', 'Fri, 04 Sep 2026 00:00:00 GMT')
    res.setHeader('ETag', '"stub-body"')
    res.end(JSON.stringify(body))
  })
}

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

/**
 * Sleep for `ms`. The real-clock wait a test needs when it is asserting on
 * something a timer drives rather than on a resolved promise. Prefer
 * {@link flush} whenever draining microtasks is enough: this one costs wall
 * time in every run.
 */
export async function sleep (ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** A subscribable bus plus the controls a test drives it with. */
export interface PositionBus {
  /** Drop-in for `app.streambundle.getSelfBus`, recording the path it is asked for. */
  getSelfBus: (path: unknown) => { onValue: (handler: (delta: never) => void) => () => void }
  /** Push a value to every live subscriber on `path`, as a `NormalizedDelta` would arrive. */
  emit: (path: string, value: unknown) => void
  /** Push a `navigation.position` fix, the overwhelmingly common case. */
  emitPosition: (latitude: number, longitude: number) => void
  /** Every path a subscription was opened on, in order. */
  subscribedPaths: () => string[]
  /** How many subscriptions have been released. */
  unsubscribedCount: () => number
}

/**
 * Build the subscribe-emit-unsubscribe half of a stub SignalK app.
 *
 * Every test that drives the position monitor or the course reader needs the
 * same three things from `streambundle`: hand out a bus, keep the handler so
 * the test can push a delta, and return an unsubscribe the test can observe.
 * Six files had grown their own copy, so the `ServerAPI` stream surface was
 * described in six places and a change to it was a six-file edit.
 *
 * Deliberately knob-free. A test that needs a bus which THROWS, or one that
 * counts `getSelfBus` calls, is testing that behavior rather than merely
 * needing a bus, so it wraps this or keeps its own rather than growing an
 * option here that every other caller then has to read past.
 */
export function createPositionBus (): PositionBus {
  const handlers = new Map<string, Array<(delta: never) => void>>()
  const subscribedPaths: string[] = []
  let unsubscribed = 0
  return {
    getSelfBus: (path: unknown) => {
      const key = String(path)
      subscribedPaths.push(key)
      return {
        onValue: (handler: (delta: never) => void) => {
          handlers.set(key, [...(handlers.get(key) ?? []), handler])
          return () => {
            unsubscribed += 1
            handlers.set(key, (handlers.get(key) ?? []).filter((entry) => entry !== handler))
          }
        }
      }
    },
    emit: (path: string, value: unknown) => {
      // Snapshot first: a handler may unsubscribe itself while being called.
      for (const handler of [...(handlers.get(path) ?? [])]) {
        (handler as (delta: unknown) => void)({ path, value })
      }
    },
    emitPosition: (latitude: number, longitude: number) => {
      for (const handler of [...(handlers.get('navigation.position') ?? [])]) {
        (handler as (delta: unknown) => void)({
          path: 'navigation.position',
          value: { latitude, longitude }
        })
      }
    },
    subscribedPaths: () => [...subscribedPaths],
    unsubscribedCount: () => unsubscribed
  }
}

/** A captured resource provider: the registrar to install, and what it caught. */
export interface CapturedResourceProvider {
  /** Drop-in for `app.registerResourceProvider`. */
  registerResourceProvider: (provider: { methods: Record<string, unknown> }) => void
  /** The registered methods, or undefined until the output registers them. */
  methods: () => Record<string, unknown> | undefined
  /** Call `listResources` on the registered provider, or resolve empty when none. */
  listResources: (query: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/**
 * Capture the `notes` resource provider an output registers, so a test can
 * call its methods. Three files had grown the same four-line closure.
 */
export function captureResourceProvider (): CapturedResourceProvider {
  let methods: Record<string, unknown> | undefined
  return {
    registerResourceProvider: (provider) => { methods = provider.methods },
    methods: () => methods,
    listResources: async (query) => {
      const list = methods?.listResources as
        ((q: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined
      return await (list?.(query) ?? Promise.resolve({}))
    }
  }
}

/**
 * Every ActiveCaptain POI-type toggle on. The type filter is opt-in per type,
 * so a test that wants the source to return anything has to set them, and two
 * files had written the list out in full.
 */
export const ALL_POI_TYPES_ON: Readonly<Record<string, boolean>> = {
  includeMarinas: true,
  includeAnchorages: true,
  includeHazards: true,
  includeBusinesses: true,
  includeBoatRamps: true,
  includeBridges: true,
  includeDams: true,
  includeFerries: true,
  includeInlets: true,
  includeLocks: true,
  includeLocalKnowledge: true,
  includeNavigational: true,
  includeAirports: true
}
