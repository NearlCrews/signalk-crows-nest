/**
 * Lifecycle async-crash contract.
 *
 * The Signal K reusable plugin-ci workflow wraps a plugin's lifecycle in an
 * async-crash trap: it installs `uncaughtException` and unhandled-rejection
 * handlers, calls `start()`, drains for a fixed window, and fails the run on
 * anything caught. It exists for the failure where a plugin starts cleanly and
 * then takes the whole server down through an unowned socket `error` event or
 * a floating rejected promise.
 *
 * This plugin is full of the code that trap is built for: timed network
 * fetches, a per-source list race whose loser keeps running, and a
 * fire-and-forget bridge-detail fetch behind a `Promise.race` timeout. So the
 * property is pinned here rather than left to CI, and a drain longer than the
 * gate's own window is used: a rejection that lands after the window still
 * takes down a running server, it just does not happen to fail the gate.
 *
 * The whole upstream transport is replaced, so the run issues no network
 * traffic. Node runs each test file in its own process, so the process-level
 * handlers this file installs cannot reach another file's tests.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import createPlugin from '../src/index.js'
import type { PluginConfig } from '../src/shared/types.js'
import {
  ALL_POI_TYPES_ON,
  captureResourceProvider,
  courseWithoutRoute,
  createPositionBus,
  sleep,
  withTempDir
} from './helpers.js'

/** The gate's own drain. Exceeded below, deliberately. */
const GATE_DRAIN_MS = 1500

/** Drain used here: past the gate's window, since a later crash is still a crash. */
const DRAIN_MS = 2000

/** Drain after `stop()`, for a teardown-time rejection. */
const STOP_DRAIN_MS = 500

interface Caught {
  kind: string
  atMs: number
  detail: string
}

/**
 * A transport that never reaches the network. Both shapes are covered: the
 * queued `fetch` client (ActiveCaptain and Overpass) and the raw
 * `node:http`/`node:https` one-shot client every other source builds on.
 *
 * `hang` leaves every request outstanding, which is what makes a `stop()`
 * land while fetches are still in flight.
 */
function installDeadTransport (mode: 'fail' | 'hang'): () => void {
  const realFetch = globalThis.fetch
  const realHttps = https.request
  const realHttp = http.request

  const requestDouble = (): EventEmitter => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void
      destroy: () => void
      setTimeout: () => void
    }
    request.end = () => {}
    request.destroy = () => {}
    request.setTimeout = () => {}
    if (mode === 'fail') {
      setTimeout(() => {
        request.emit('error', new Error('simulated transport failure'))
      }, 5)
    }
    return request
  }
  ;(https as unknown as { request: unknown }).request = requestDouble
  ;(http as unknown as { request: unknown }).request = requestDouble
  globalThis.fetch = (async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (mode === 'hang') {
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => { reject(init.signal?.reason ?? new Error('aborted')) },
          { once: true }
        )
      })
    }
    await sleep(5)
    throw new TypeError('simulated fetch failure')
  }) as typeof fetch

  return () => {
    globalThis.fetch = realFetch
    ;(https as unknown as { request: unknown }).request = realHttps
    ;(http as unknown as { request: unknown }).request = realHttp
  }
}

/** Every source and every output on, so no path is skipped by configuration. */
function everythingOnConfig (): PluginConfig {
  return {
    ...ALL_POI_TYPES_ON,
    cachingDurationMinutes: 1440,
    enableProximityAlarms: true,
    proximityAlarmRadiusMeters: 500,
    enableRouteHazardScan: true,
    routeCorridorWidthMeters: 500,
    enableBridgeAirDraftCheck: true,
    vesselAirDraftMeters: 18,
    openSeaMapEnabled: true,
    uscgLightListEnabled: true,
    noaaEncEnabled: true,
    noaaEncIncludeWrecks: true,
    noaaEncIncludeObstructions: true,
    noaaEncIncludeRocks: true,
    noaaCoopsEnabled: true,
    noaaCoopsIncludeTideStations: true,
    uscgLnmEnabled: true,
    wpiEnabled: true,
    usaceEnabled: true,
    usaceIncludeLocks: true
  }
}

/** A stub app exposing the position bus and the notes provider the run drives. */
function createStubApp (dataDir: string): {
  app: Record<string, unknown>
  emitPosition: (latitude: number, longitude: number) => void
  listNotes: () => Promise<unknown>
} {
  // Composed from the shared stream and resource-provider harnesses rather
  // than hand-rolled, so this file does not become another place the
  // `ServerAPI` surface is described.
  const bus = createPositionBus()
  const provider = captureResourceProvider()
  const app: Record<string, unknown> = {
    debug: () => {},
    error: () => {},
    setPluginStatus: () => {},
    setPluginError: () => {},
    getDataDirPath: () => dataDir,
    handleMessage: () => {},
    registerResourceProvider: provider.registerResourceProvider,
    getSelfPath: (path: string) =>
      path === 'navigation.position' ? { latitude: 41.5, longitude: -71.3 } : undefined,
    getCourse: async () => courseWithoutRoute(),
    resourcesApi: {
      getResource: async () => { throw new Error('no routes provider') }
    },
    streambundle: { getSelfBus: bus.getSelfBus }
  }
  return {
    app,
    emitPosition: bus.emitPosition,
    listNotes: async () =>
      await provider.listResources({
        position: { latitude: 41.5, longitude: -71.3 },
        distance: 5000
      })
  }
}

/**
 * Run one lifecycle under the trap and return everything it caught, stamped
 * with how long after `start()` returned each one arrived.
 */
async function runUnderTrap (
  mode: 'fail' | 'hang',
  stopEarly: boolean
): Promise<Caught[]> {
  const caught: Caught[] = []
  let startedAt = Number.NaN
  const record = (kind: string) => (value: unknown) => {
    caught.push({
      kind,
      atMs: Number.isNaN(startedAt) ? -1 : Date.now() - startedAt,
      detail: value instanceof Error ? `${value.name}: ${value.message}` : String(value)
    })
  }
  const onException = record('uncaughtException')
  const onRejection = record('unhandledRejection')
  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)

  const restoreTransport = installDeadTransport(mode)
  try {
    await withTempDir('crows-nest-async-crash-', async (dataDir) => {
      const stub = createStubApp(dataDir)
      const plugin = createPlugin(stub.app as never)
      // The second argument is the server's restart callback, which this
      // plugin never calls; it is passed because the interface requires it.
      plugin.start(everythingOnConfig(), () => {})
      startedAt = Date.now()

      // Drive the two paths that reach every upstream: the monitor tick and
      // the chart list. The caller's own rejection is caught here; only an
      // UNHANDLED one is the subject of this test.
      stub.emitPosition(41.5, -71.3)
      stub.listNotes().catch(() => {})

      if (stopEarly) {
        await sleep(100)
        await plugin.stop()
        await sleep(DRAIN_MS)
      } else {
        await sleep(DRAIN_MS)
        await plugin.stop()
        await sleep(STOP_DRAIN_MS)
      }
    })
  } finally {
    restoreTransport()
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejection)
  }
  return caught
}

/** Render the catches for an assertion message that names what went wrong. */
function describe (caught: Caught[]): string {
  return caught
    .map((entry) => `${entry.kind} at +${entry.atMs} ms: ${entry.detail}`)
    .join('; ')
}

test('a failing upstream crashes nothing across the plugin lifecycle', async () => {
  const caught = await runUnderTrap('fail', false)
  assert.equal(
    caught.length,
    0,
    'start, run, and stop must raise no unhandled rejection or uncaught exception (the ' +
    `plugin-ci async-crash trap fails on anything inside ${GATE_DRAIN_MS} ms): ${describe(caught)}`
  )
})

test('stopping while upstream requests are in flight crashes nothing', async () => {
  // The classic source of a floating rejection: teardown lands first and the
  // request settles onto a run that is already gone.
  const caught = await runUnderTrap('hang', true)
  assert.equal(
    caught.length,
    0,
    `a stop issued mid-flight must raise no unhandled rejection or uncaught exception: ${describe(caught)}`
  )
})
