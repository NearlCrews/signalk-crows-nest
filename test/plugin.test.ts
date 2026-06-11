import test from 'node:test'
import assert from 'node:assert/strict'
import type { ServerAPI } from '@signalk/server-api'
import type { IRouter } from 'express'
import { createPlugin } from '../src/plugin/plugin.js'
import { createInputRegistry } from '../src/inputs/input-registry.js'
import { createOutputRegistry } from '../src/outputs/output-registry.js'
import type { InputContext, InputModule, PoiSource } from '../src/inputs/poi-source.js'
import type { OutputHandle, OutputModule, PositionScanContributor } from '../src/outputs/output.js'
import type { Position } from '../src/shared/types.js'

/** A minimal config: only the one always-required property. */
const CONFIG = { cachingDurationMinutes: 60 }

/** The `restart` callback the server passes to `start`; unused by these tests. */
const noopRestart = (): void => {}

/** A stubbed ServerAPI recording every call the plugin makes against it. */
interface StubApp {
  app: ServerAPI
  statusMessages: string[]
  errorMessages: string[]
  pluginErrors: string[]
  getSelfBusCalls: () => number
  adminGatedPaths: string[]
  /** Feed a value through the position stream the monitor subscribed to. */
  emitPosition: (value: unknown) => void
}

/**
 * Build a stub SignalK app. With `monitorThrows`, the position stream lookup
 * throws, so a position monitor construction failure can be exercised.
 */
function createStubApp (options: { monitorThrows?: boolean } = {}): StubApp {
  const statusMessages: string[] = []
  const errorMessages: string[] = []
  const pluginErrors: string[] = []
  const adminGatedPaths: string[] = []
  let getSelfBusCount = 0
  let positionHandler: ((delta: { value: unknown }) => void) | undefined
  const app = {
    getDataDirPath: () => '/tmp/crows-nest-test',
    setPluginStatus: (message: string) => { statusMessages.push(message) },
    setPluginError: (message: string) => { pluginErrors.push(message) },
    error: (message: string) => { errorMessages.push(message) },
    debug: () => {},
    streambundle: {
      getSelfBus: () => {
        getSelfBusCount++
        if (options.monitorThrows === true) {
          throw new Error('position stream unavailable')
        }
        return {
          onValue: (handler: (delta: { value: unknown }) => void) => {
            positionHandler = handler
            return () => { positionHandler = undefined }
          }
        }
      }
    },
    securityStrategy: {
      addAdminMiddleware: (path: string) => { adminGatedPaths.push(path) }
    }
  }
  return {
    app: app as unknown as ServerAPI,
    statusMessages,
    errorMessages,
    pluginErrors,
    getSelfBusCalls: () => getSelfBusCount,
    adminGatedPaths,
    emitPosition: (value: unknown) => { positionHandler?.({ value }) }
  }
}

/** A stub input module that records how often each built source is closed. */
interface StubInput {
  module: InputModule
  sources: Array<{ closeCount: number }>
}

function createStubInput (): StubInput {
  const sources: Array<{ closeCount: number }> = []
  const module: InputModule = {
    id: 'stubinput',
    name: 'Stub Input',
    configSchema: {
      cachingDurationMinutes: { type: 'number' },
      stubInputEnabled: { type: 'boolean' }
    },
    isEnabled: () => true,
    createSource: (): PoiSource => {
      const record = { closeCount: 0 }
      sources.push(record)
      return {
        id: 'stubinput',
        listPointsOfInterest: async () => [],
        getDetails: async () => { throw new Error('unused') },
        cacheSize: () => 7,
        close: () => { record.closeCount++ }
      }
    }
  }
  return { module, sources }
}

/** A stub output module that records how often each handle is stopped. */
interface StubOutput {
  module: OutputModule
  handles: Array<{ stopCount: number }>
}

function createStubOutput (options: {
  id: string
  positionDriven?: boolean
  stopThrows?: boolean
  startThrows?: boolean
}): StubOutput {
  const handles: Array<{ stopCount: number }> = []
  const positionScan: PositionScanContributor | undefined =
    options.positionDriven === true
      ? { poiTypes: ['Hazard'], buildFetchBox: () => null, evaluate: () => {} }
      : undefined
  const module: OutputModule = {
    id: options.id,
    name: options.id,
    configSchema: { [`enable_${options.id}`]: { type: 'boolean' } },
    isEnabled: () => true,
    start: (): OutputHandle => {
      if (options.startThrows === true) {
        throw new Error(`${options.id} start failed`)
      }
      const record = { stopCount: 0 }
      handles.push(record)
      const handle: OutputHandle = {
        stop: () => {
          record.stopCount++
          if (options.stopThrows === true) {
            throw new Error(`${options.id} stop failed`)
          }
        }
      }
      if (positionScan !== undefined) {
        handle.positionScan = positionScan
      }
      return handle
    }
  }
  return { module, handles }
}

test("schema is assembled from the registries' fragments", () => {
  const input = createStubInput()
  const outA = createStubOutput({ id: 'out-a' })
  const outB = createStubOutput({ id: 'out-b', positionDriven: true })
  const plugin = createPlugin(
    createStubApp().app,
    createInputRegistry([input.module]),
    createOutputRegistry([outA.module, outB.module])
  )
  const schema = plugin.schema as unknown as {
    required: string[]
    properties: Record<string, unknown>
  }
  assert.deepEqual(schema.required, ['cachingDurationMinutes'])
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    ['cachingDurationMinutes', 'enable_out-a', 'enable_out-b', 'stubInputEnabled'].sort(),
    'every input and output fragment is merged into the schema'
  )
})

test('start builds the source and starts the enabled outputs', () => {
  const input = createStubInput()
  const outA = createStubOutput({ id: 'out-a' })
  const outB = createStubOutput({ id: 'out-b' })
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([outA.module, outB.module])
  )
  plugin.start(CONFIG, noopRestart)
  assert.equal(input.sources.length, 1, 'one POI source is built')
  assert.equal(outA.handles.length, 1, 'output A is started')
  assert.equal(outB.handles.length, 1, 'output B is started')
  assert.deepEqual(stub.statusMessages, ['Starting', 'Ready, 1 source(s) and 2 output(s) enabled'])
  plugin.stop()
})

test('a second start without a stop tears the previous runtime down first', () => {
  const input = createStubInput()
  const out = createStubOutput({ id: 'out' })
  const plugin = createPlugin(
    createStubApp().app,
    createInputRegistry([input.module]),
    createOutputRegistry([out.module])
  )
  plugin.start(CONFIG, noopRestart)
  plugin.start(CONFIG, noopRestart)
  assert.equal(input.sources.length, 2, 'the second start builds a fresh source')
  assert.equal(input.sources[0].closeCount, 1, 'the first source is closed before the rebuild')
  assert.equal(out.handles.length, 2, 'the second start starts a fresh handle')
  assert.equal(out.handles[0].stopCount, 1, 'the first handle is stopped before the rebuild')
  plugin.stop()
})

test('the position monitor always starts so inputs and outputs can read the current fix', () => {
  // The US-only inputs read position through InputContext.getCurrentPosition,
  // which is plumbed through the position monitor. The monitor therefore
  // always starts, regardless of whether a position-driven output is enabled.
  const plain = createStubOutput({ id: 'plain' })
  const stubPlain = createStubApp()
  const pluginPlain = createPlugin(
    stubPlain.app,
    createInputRegistry([createStubInput().module]),
    createOutputRegistry([plain.module])
  )
  pluginPlain.start(CONFIG, noopRestart)
  assert.equal(stubPlain.getSelfBusCalls(), 1, 'the monitor subscribes even without a position-driven output')
  pluginPlain.stop()

  const driven = createStubOutput({ id: 'driven', positionDriven: true })
  const stubDriven = createStubApp()
  const pluginDriven = createPlugin(
    stubDriven.app,
    createInputRegistry([createStubInput().module]),
    createOutputRegistry([driven.module])
  )
  pluginDriven.start(CONFIG, noopRestart)
  assert.equal(stubDriven.getSelfBusCalls(), 1, 'the monitor still subscribes once for a position-driven output')
  pluginDriven.stop()
})

test('the InputContext getCurrentPosition reader is wired to the position monitor', () => {
  // The plugin shell's reader must reach into the runtime's monitor; a stub
  // input captures the closure on createSource and the test asserts the
  // reader returns undefined until the monitor sees its first fix.
  const sources: Array<{ closeCount: number }> = []
  let capturedReader: (() => Position | undefined) | undefined
  const captureModule: InputModule = {
    id: 'captureinput',
    name: 'Capture Input',
    configSchema: { cachingDurationMinutes: { type: 'number' } },
    isEnabled: () => true,
    createSource: (context: InputContext): PoiSource => {
      capturedReader = context.getCurrentPosition
      const record = { closeCount: 0 }
      sources.push(record)
      return {
        id: 'captureinput',
        listPointsOfInterest: async () => [],
        getDetails: async () => { throw new Error('unused') },
        cacheSize: () => 0,
        close: () => { record.closeCount++ }
      }
    }
  }
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([captureModule]),
    createOutputRegistry([createStubOutput({ id: 'plain' }).module])
  )
  plugin.start(CONFIG, noopRestart)
  assert.equal(typeof capturedReader, 'function', 'the input received a getCurrentPosition reader')
  // Before any fix arrives, the reader returns undefined.
  assert.equal(capturedReader?.(), undefined, 'no fix yet means the reader returns undefined')
  // A position fix flows through the monitor and the reader returns it.
  stub.emitPosition({ latitude: 42.36, longitude: -71.05 })
  assert.deepEqual(
    capturedReader?.(),
    { latitude: 42.36, longitude: -71.05 },
    'the reader returns the latest fix the monitor has tracked'
  )
  plugin.stop()
})

test('an output start failure is surfaced as a plugin error, not as "Ready"', () => {
  // An enabled output whose start() throws is isolated by the registry and
  // excluded from startedIds. The plugin must surface that via setPluginError
  // and must not report the bland "Ready" status that would mask a dead output.
  const input = createStubInput()
  const failing = createStubOutput({ id: 'failing', startThrows: true })
  const healthy = createStubOutput({ id: 'healthy' })
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([failing.module, healthy.module])
  )
  plugin.start(CONFIG, noopRestart)
  assert.equal(failing.handles.length, 0, 'the failing output never produced a handle')
  assert.equal(healthy.handles.length, 1, 'the healthy output still started')
  assert.equal(stub.pluginErrors.length, 1, 'a plugin error is surfaced')
  assert.match(stub.pluginErrors[0], /failing/, 'the error names the failed output')
  assert.deepEqual(stub.statusMessages, ['Starting'], '"Ready" must not mask the failure')
  plugin.stop()
})

test('a position monitor construction failure is isolated and surfaced', () => {
  const input = createStubInput()
  const driven = createStubOutput({ id: 'driven', positionDriven: true })
  const stub = createStubApp({ monitorThrows: true })
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([driven.module])
  )
  plugin.start(CONFIG, noopRestart)
  assert.equal(driven.handles.length, 1, 'the position-driven output is still started')
  assert.equal(stub.pluginErrors.length, 1, 'a plugin error is surfaced')
  assert.match(stub.pluginErrors[0], /alarms are not running/)
  assert.deepEqual(stub.statusMessages, ['Starting'], 'the bland Ready status does not overwrite the error')
  plugin.stop()
})

test('a latched start error is not overwritten by an output status write', () => {
  // The notes output reports each successful list request through
  // setPluginStatus. The server shares one status slot, last writer wins, so
  // when start() latched a plugin error (dead monitor or failed output) that
  // per-request healthy status must not clear it: the guarded app the outputs
  // receive suppresses status writes while the latch is set.
  const input = createStubInput()
  let capturedApp: ServerAPI | undefined
  const capturing: OutputModule = {
    id: 'capturing',
    name: 'capturing',
    configSchema: {},
    isEnabled: () => true,
    start: (context) => {
      capturedApp = context.app
      return { stop: () => {} }
    }
  }
  const failing = createStubOutput({ id: 'failing', startThrows: true })
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([capturing, failing.module])
  )
  plugin.start(CONFIG, noopRestart)
  assert.equal(stub.pluginErrors.length, 1, 'the failed output latched a plugin error')
  capturedApp?.setPluginStatus('5 point(s) of interest from the last search')
  assert.deepEqual(
    stub.statusMessages,
    ['Starting'],
    'the healthy write is suppressed while the error is latched'
  )
  capturedApp?.setPluginError('list failed')
  assert.equal(stub.pluginErrors.length, 2, 'error writes still delegate to the real app')
  plugin.stop()
})

test('output status writes pass through when start succeeded', () => {
  const input = createStubInput()
  let capturedApp: ServerAPI | undefined
  const capturing: OutputModule = {
    id: 'capturing',
    name: 'capturing',
    configSchema: {},
    isEnabled: () => true,
    start: (context) => {
      capturedApp = context.app
      return { stop: () => {} }
    }
  }
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([capturing])
  )
  plugin.start(CONFIG, noopRestart)
  capturedApp?.setPluginStatus('5 point(s) of interest from the last search')
  assert.deepEqual(stub.statusMessages, [
    'Starting',
    'Ready, 1 source(s) and 1 output(s) enabled',
    '5 point(s) of interest from the last search'
  ])
  plugin.stop()
})

test('stop is idempotent and tolerates a throwing handle', () => {
  const input = createStubInput()
  const throwing = createStubOutput({ id: 'throwing', stopThrows: true })
  const healthy = createStubOutput({ id: 'healthy' })
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([throwing.module, healthy.module])
  )
  plugin.start(CONFIG, noopRestart)
  plugin.stop()
  assert.equal(throwing.handles[0].stopCount, 1, 'the throwing handle was stopped')
  assert.equal(healthy.handles[0].stopCount, 1, 'a throwing handle does not skip the others')
  assert.equal(input.sources[0].closeCount, 1, 'the source is still closed despite the throw')
  assert.ok(
    stub.errorMessages.some((message) => message.includes('Cannot stop an output')),
    'the failing stop is logged via app.error'
  )
  // A second stop is harmless: the runtime is already gone.
  plugin.stop()
  assert.equal(healthy.handles[0].stopCount, 1, 'a second stop does not re-stop the handles')
})

test('the status router serves the snapshot', () => {
  const input = createStubInput()
  const out = createStubOutput({ id: 'out' })
  const stub = createStubApp()
  const plugin = createPlugin(
    stub.app,
    createInputRegistry([input.module]),
    createOutputRegistry([out.module])
  )
  plugin.start(CONFIG, noopRestart)

  let statusHandler: ((req: unknown, res: unknown) => void) | undefined
  const router = {
    get: (path: string, handler: (req: unknown, res: unknown) => void) => {
      if (path === '/api/status') {
        statusHandler = handler
      }
    }
  }
  plugin.registerWithRouter?.(router as unknown as IRouter)
  assert.equal(stub.adminGatedPaths.length, 1, 'the api subtree is admin-gated')
  assert.ok(statusHandler !== undefined, 'the status route is registered')

  let body: unknown
  statusHandler?.({}, { json: (payload: unknown) => { body = payload } })
  const snapshot = body as { cachedPoiCount: number, startedAt: string }
  assert.equal(snapshot.cachedPoiCount, 7, 'the snapshot carries the source cache size')
  assert.equal(typeof snapshot.startedAt, 'string', 'the snapshot carries a start time')
  plugin.stop()
})
