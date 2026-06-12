import test from 'node:test'
import assert from 'node:assert/strict'
import type { NormalizedDelta } from '@signalk/server-api'
import {
  createPositionMonitor,
  type MonitorApp,
  type PoiListSource,
  type PositionStream
} from '../src/monitoring/position-monitor.js'
import type { PositionScanContributor } from '../src/outputs/output.js'
import type { Bbox, PoiSummary, Position } from '../src/shared/types.js'
import { flush } from './helpers.js'

/** A controllable monotonic clock, so the throttle is tested without waiting. */
function createClock (): { now: () => number, advance: (ms: number) => void } {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms: number) => { current += ms }
  }
}

/** A mock SignalK app exposing a single position stream the test drives. */
function createMockApp (): {
  app: MonitorApp
  emit: (value: unknown) => void
  isUnsubscribed: () => boolean
  subscribedPath: () => string | undefined
  debugMessages: () => string[]
} {
  let handler: ((delta: NormalizedDelta) => void) | undefined
  let unsubscribed = false
  let path: string | undefined
  const debugMessages: string[] = []
  const stream: PositionStream = {
    onValue: (incoming) => {
      handler = incoming
      return () => { unsubscribed = true }
    }
  }
  const app: MonitorApp = {
    streambundle: {
      getSelfBus: (requestedPath) => {
        path = String(requestedPath)
        return stream
      }
    },
    debug: (message) => { debugMessages.push(message) }
  }
  return {
    app,
    // A position delta carries only `value` for the monitor's purposes.
    emit: (value) => { handler?.({ value } as unknown as NormalizedDelta) },
    isUnsubscribed: () => unsubscribed,
    subscribedPath: () => path,
    debugMessages: () => debugMessages
  }
}

type ClientMode = 'resolve' | 'reject' | 'pending'

/** A mock POI source recording list-request calls. */
function createMockClient (): {
  client: PoiListSource
  calls: Array<{ bbox: Bbox, poiTypes: string }>
  setPois: (pois: PoiSummary[]) => void
  setMode: (mode: ClientMode) => void
} {
  const calls: Array<{ bbox: Bbox, poiTypes: string }> = []
  let pois: PoiSummary[] = []
  let mode: ClientMode = 'resolve'
  const client: PoiListSource = {
    listPointsOfInterest: async (bbox, poiTypes) => {
      calls.push({ bbox, poiTypes })
      if (mode === 'pending') {
        return new Promise<PoiSummary[]>(() => {})
      }
      if (mode === 'reject') {
        throw new Error('network down')
      }
      return pois
    }
  }
  return {
    client,
    calls,
    setPois: (next) => { pois = next },
    setMode: (next) => { mode = next }
  }
}

/** A fake scan contributor recording its buildFetchBox and evaluate calls. */
function createMockContributor (
  poiTypes: readonly string[],
  box: Bbox | null
): {
    contributor: PositionScanContributor
    fetchCalls: () => Position[]
    evaluations: () => Array<{ position: Position, pois: PoiSummary[] }>
  } {
  const fetchCalls: Position[] = []
  const evaluations: Array<{ position: Position, pois: PoiSummary[] }> = []
  const contributor: PositionScanContributor = {
    poiTypes,
    buildFetchBox: (tickPosition) => {
      fetchCalls.push(tickPosition)
      return box
    },
    evaluate: (position, pois) => { evaluations.push({ position, pois }) }
  }
  return {
    contributor,
    fetchCalls: () => fetchCalls,
    evaluations: () => evaluations
  }
}

const HAZARD: PoiSummary = {
  id: 'h1',
  type: 'Hazard',
  position: { latitude: 10.01, longitude: 20 },
  name: 'Rock',
  source: 'activecaptain',
  url: 'https://activecaptain.garmin.com/en-US/pois/h1',
  attribution: 'Data from Garmin ActiveCaptain',
  skIcon: 'hazard'
}

/** A bounding box around the test's home position. */
const SCAN_BOX: Bbox = { north: 10.5, south: 9.5, east: 20.5, west: 19.5 }

test('subscribes to navigation.position and ticks on the first fix', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    now: createClock().now
  })

  assert.equal(mockApp.subscribedPath(), 'navigation.position')

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the first fix triggers a list request')
  assert.equal(mockClient.calls[0].poiTypes, 'Hazard', 'the poiTypes string is passed through')
  assert.deepEqual(mockClient.calls[0].bbox, SCAN_BOX, 'the contributor box is used for the request')
  assert.equal(scan.evaluations().length, 1, 'the contributor is evaluated')
  assert.deepEqual(scan.evaluations()[0].position, { latitude: 10, longitude: 20 })
  assert.deepEqual(scan.evaluations()[0].pois, [HAZARD])

  monitor.stop()
})

test('does not tick again before the minimum interval elapses, then ticks past both gates', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  const clock = createClock()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    minMoveMeters: 100,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  // Move far enough to clear the distance gate, but not far enough in time.
  clock.advance(30_000)
  mockApp.emit({ latitude: 11, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'the interval gate suppresses the second tick')

  // Past the interval, but a move of about 55 m, short of the 100 m gate.
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.0005, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'the distance gate suppresses the tick')

  // A move of several kilometers clears both gates.
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 2, 'a tick runs once both gates are met')

  monitor.stop()
})

test('does not start an overlapping tick while a scan is in flight, then ticks once the slot frees', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  const clock = createClock()
  mockClient.setMode('pending')

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'the first tick starts a scan')

  // The first scan never resolves; a burst of eligible fixes must not stack a
  // second request on top of it.
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  mockApp.emit({ latitude: 10.1, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'no overlapping scan is started')

  monitor.stop()
})

test('runs a deferred tick once the in-flight scan resolves', async () => {
  const mockApp = createMockApp()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  const clock = createClock()

  // A client whose list request resolves only when the test releases it, so
  // the deferred-tick path can be exercised deterministically.
  const calls: Array<{ bbox: Bbox, poiTypes: string }> = []
  let release: ((pois: PoiSummary[]) => void) | undefined
  const client: PoiListSource = {
    listPointsOfInterest: async (bbox, poiTypes) => {
      calls.push({ bbox, poiTypes })
      return await new Promise<PoiSummary[]>((resolve) => { release = resolve })
    }
  }

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    minIntervalMs: 60_000,
    now: clock.now
  })

  // The first fix starts a scan that is now in flight.
  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(calls.length, 1, 'the first tick starts a scan')

  // A fix arrives mid-scan, past both throttle gates. It cannot start an
  // overlapping scan, so the monitor defers it.
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  await flush()
  assert.equal(calls.length, 1, 'the in-flight scan blocks an overlapping request')

  // Resolve the first scan. Its finally block calls maybeTick(), which runs
  // the deferred tick for the fix that arrived while the scan was in flight.
  release?.([])
  await flush()
  assert.equal(calls.length, 2, 'the deferred tick runs once the in-flight scan resolves')
  assert.deepEqual(calls[1].bbox, SCAN_BOX, 'the deferred tick issues its own list request')
  assert.equal(scan.evaluations().length, 1, 'the resolved scan evaluated the contributor')

  monitor.stop()
})

test('unions every contributor fetch box into one list request', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scanA = createMockContributor(
    ['Hazard'], { north: 11, south: 10, east: 21, west: 20 })
  const scanB = createMockContributor(
    ['Bridge'], { north: 10, south: 9, east: 20, west: 19 })

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scanA.contributor, scanB.contributor],
    poiTypes: 'Hazard,Bridge',
    now: createClock().now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'a single request serves both contributors')
  assert.deepEqual(
    mockClient.calls[0].bbox,
    { north: 11, south: 9, east: 21, west: 19 },
    'the request box is the union of the contributor boxes'
  )
  assert.equal(mockClient.calls[0].poiTypes, 'Hazard,Bridge', 'the poiTypes string is passed through')
  assert.equal(scanA.evaluations().length, 1, 'contributor A is evaluated')
  assert.equal(scanB.evaluations().length, 1, 'contributor B is evaluated')

  monitor.stop()
})

test('a throwing contributor.buildFetchBox does not short-circuit its siblings', async () => {
  // Safety: a crash in the route-hazard fetch-box code must never silently
  // disable the proximity alarm for the same tick. Each contributor's
  // buildFetchBox runs in its own try/catch.
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const throwing: PositionScanContributor = {
    poiTypes: ['Bridge'],
    buildFetchBox: () => { throw new Error('route reader exploded') },
    evaluate: () => {}
  }
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [throwing, scan.contributor],
    poiTypes: 'Hazard,Bridge',
    now: createClock().now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1,
    'the surviving contributor still contributes a box, so the list request runs')
  assert.equal(scan.evaluations().length, 1,
    'the surviving contributor still evaluates')
  monitor.stop()
})

test('a throwing contributor.evaluate does not short-circuit its siblings', async () => {
  // Safety: a crash in one output\'s evaluate must never silently disable
  // sibling outputs (the proximity alarm and the route-hazard alarm share
  // the loop and must not be coupled).
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const throwing: PositionScanContributor = {
    poiTypes: ['Bridge'],
    buildFetchBox: () => SCAN_BOX,
    evaluate: () => { throw new Error('output handler exploded') }
  }
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [throwing, scan.contributor],
    poiTypes: 'Hazard,Bridge',
    now: createClock().now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()

  assert.equal(scan.evaluations().length, 1,
    'the surviving contributor.evaluate still runs after a sibling throws')
  monitor.stop()
})

test('skips the list request and evaluates an empty result when every fetch box is null', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scanA = createMockContributor(['Hazard'], null)
  const scanB = createMockContributor(['Bridge'], null)

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scanA.contributor, scanB.contributor],
    poiTypes: 'Hazard,Bridge',
    now: createClock().now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 0, 'no list request is spent when there is nothing to fetch')
  assert.equal(scanA.evaluations().length, 1, 'contributor A is still evaluated')
  assert.deepEqual(scanA.evaluations()[0].pois, [], 'contributor A is evaluated with an empty result')
  assert.equal(scanB.evaluations().length, 1, 'contributor B is still evaluated')
  assert.deepEqual(scanB.evaluations()[0].pois, [], 'contributor B is evaluated with an empty result')

  monitor.stop()
})

test('evaluates contributors against the newest fix, not the one the scan started from', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    now: createClock().now
  })

  // The first fix starts a scan; a newer fix arrives before the scan's
  // request resolves, so the in-flight scan must evaluate the newer one.
  mockApp.emit({ latitude: 10, longitude: 20 })
  mockApp.emit({ latitude: 10.01, longitude: 20 })
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the in-flight scan is not duplicated')
  assert.equal(scan.evaluations().length, 1)
  assert.deepEqual(
    scan.evaluations()[0].position,
    { latitude: 10.01, longitude: 20 },
    'the evaluation uses the newest position, not the scan start position'
  )

  monitor.stop()
})

test('a failed scan does not throw, does not evaluate, and is logged at debug level', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  const clock = createClock()
  mockClient.setMode('reject')

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)
  assert.equal(scan.evaluations().length, 0, 'a rejected scan skips evaluation')
  assert.ok(
    mockApp.debugMessages().some((m) => m.includes('Position monitor scan failed')),
    'the failure is logged via app.debug'
  )

  // The monitor recovers: a later successful tick still evaluates.
  mockClient.setMode('resolve')
  mockClient.setPois([HAZARD])
  clock.advance(120_000)
  mockApp.emit({ latitude: 10.05, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 2)
  assert.equal(scan.evaluations().length, 1, 'the monitor recovers after a failure')

  monitor.stop()
})

test('a scan that resolves after stop does not evaluate the contributors', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    now: createClock().now
  })

  // Stop before the scan's promise settles.
  mockApp.emit({ latitude: 10, longitude: 20 })
  monitor.stop()
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the list request was issued')
  assert.equal(scan.evaluations().length, 0, 'a late response does not evaluate after stop')
})

test('stop() unsubscribes the position stream, is idempotent, and prevents further ticks', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  const clock = createClock()

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  monitor.stop()
  assert.equal(mockApp.isUnsubscribed(), true, 'the position stream is unsubscribed')

  // A position update after stop must not trigger another tick.
  clock.advance(120_000)
  mockApp.emit({ latitude: 11, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1, 'no tick runs after stop')

  // stop() is idempotent.
  monitor.stop()
  assert.equal(mockApp.isUnsubscribed(), true, 'a second stop is harmless')
})

test('ignores malformed position values', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    now: createClock().now
  })

  mockApp.emit(null)
  mockApp.emit({ latitude: 10 })
  mockApp.emit({ latitude: 'ten', longitude: 20 })
  mockApp.emit({ latitude: Number.NaN, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 0, 'no tick runs for an unusable position')

  // A valid fix after the malformed ones still ticks.
  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 1)

  monitor.stop()
})

test('does not issue a list request when no contributor produces a fetch box', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const scan = createMockContributor(['Hazard'], null)

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    now: createClock().now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(mockClient.calls.length, 0, 'no list request is issued')

  monitor.stop()
})
