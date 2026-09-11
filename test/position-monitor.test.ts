import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPositionMonitor,
  type MonitorApp,
  type PoiListSource
} from '../src/monitoring/position-monitor.js'
import type { PositionScanContributor } from '../src/outputs/output.js'
import type { Bbox, PoiSummary, PoiType, Position } from '../src/shared/types.js'
import { createPositionBus, flush, poiSummary } from './helpers.js'

/** A controllable monotonic clock, so the throttle is tested without waiting. */
function createClock (): { now: () => number, advance: (ms: number) => void } {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms: number) => { current += ms }
  }
}

/**
 * A mock SignalK app exposing a single position stream the test drives.
 *
 * The stream half comes from the shared {@link createPositionBus} rather than
 * being hand-rolled here, so the `ServerAPI` stream surface is described once
 * for the whole suite. The convenience wrappers below are this file's own: 43
 * call sites push a bare position value, including deliberately malformed
 * ones, and that shape is worth keeping local.
 */
function createMockApp (): {
  app: MonitorApp
  emit: (value: unknown) => void
  isUnsubscribed: () => boolean
  /**
   * Subscriptions opened but not yet released. Zero is the property a failed
   * construction has to leave behind, and it reads the same whether the
   * monitor never subscribed or subscribed and then unwound.
   */
  liveSubscriptions: () => number
  subscribedPath: () => string | undefined
  debugMessages: () => string[]
  errorMessages: () => string[]
} {
  const bus = createPositionBus()
  const debugMessages: string[] = []
  const errorMessages: string[] = []
  const app: MonitorApp = {
    streambundle: {
      getSelfBus: bus.getSelfBus as MonitorApp['streambundle']['getSelfBus']
    },
    debug: (message) => { debugMessages.push(message) },
    error: (message) => { errorMessages.push(message) }
  }
  return {
    app,
    // A position delta carries only `value` for the monitor's purposes.
    emit: (value) => { bus.emit('navigation.position', value) },
    isUnsubscribed: () => bus.unsubscribedCount() > 0,
    liveSubscriptions: () => bus.subscribedPaths().length - bus.unsubscribedCount(),
    subscribedPath: () => bus.subscribedPaths()[0],
    debugMessages: () => debugMessages,
    errorMessages: () => errorMessages
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

test('a contributor can request a scan while the vessel remains stationary', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()
  let requestScan: (() => void) | undefined
  const evaluations: Position[] = []
  const contributor: PositionScanContributor = {
    poiTypes: ['Hazard'],
    setScanRequester: (request) => { requestScan = request },
    buildFetchBox: () => null,
    evaluate: (position) => { evaluations.push(position) }
  }

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [contributor],
    poiTypes: 'Hazard',
    minMoveMeters: 100,
    minIntervalMs: 60_000,
    now: clock.now
  })

  mockApp.emit({ latitude: 10, longitude: 20 })
  await flush()
  assert.equal(evaluations.length, 1)

  requestScan?.()
  await flush()
  assert.equal(evaluations.length, 2, 'the invalidation bypasses position throttle gates')
  assert.deepEqual(evaluations[1], { latitude: 10, longitude: 20 })

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

test('unions contributor boxes across the antimeridian without querying the globe', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const westSide = createMockContributor(
    ['Hazard'], { north: 11, south: 10, west: 179, east: 180 })
  const eastSide = createMockContributor(
    ['Bridge'], { north: 10, south: 9, west: -180, east: -179 })

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [westSide.contributor, eastSide.contributor],
    poiTypes: 'Hazard,Bridge',
    now: createClock().now
  })

  mockApp.emit({ latitude: 10, longitude: 179.5 })
  await flush()

  assert.equal(mockClient.calls.length, 1)
  assert.deepEqual(
    mockClient.calls[0].bbox,
    { north: 11, south: 9, west: 179, east: -179 },
    'the shared request keeps the narrow wrapped interval'
  )

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

/**
 * Meters per degree on the spherical Earth the geo helpers use, so a fixture
 * can be placed at a known offset from the equator without importing the
 * projection helpers the code under test uses.
 */
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180

/** Meters per second for a speed in knots. */
const METERS_PER_SECOND_PER_KNOT = 1852 / 3600

/** A position `metersEast` along a due-east track on the equator. */
function eastAt (metersEast: number): Position {
  return { latitude: 0, longitude: metersEast / METERS_PER_DEGREE }
}

/**
 * Drive a monitor along a due-east equatorial track past one hazard, with a
 * fix every second, and report which evaluations found the hazard inside the
 * alarm radius. `phaseSeconds` slides the track's start so the sweep covers
 * every phase the throttle can land on.
 */
async function runPast (options: {
  speedKnots: number
  abeamMeters: number
  alarmRadiusMeters: number
  phaseSeconds: number
}): Promise<{ sightings: number, errors: string[] }> {
  const { speedKnots, abeamMeters, alarmRadiusMeters, phaseSeconds } = options
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()
  const hazard: PoiSummary = {
    ...HAZARD,
    position: {
      latitude: abeamMeters / METERS_PER_DEGREE,
      longitude: 5000 / METERS_PER_DEGREE
    }
  }
  mockClient.setPois([hazard])

  let sightings = 0
  const contributor: PositionScanContributor = {
    poiTypes: ['Hazard'],
    alarmRadiusMeters,
    buildFetchBox: () => SCAN_BOX,
    evaluate: (position, pois) => {
      for (const poi of pois) {
        const north = (poi.position.latitude - position.latitude) * METERS_PER_DEGREE
        const east = (poi.position.longitude - position.longitude) * METERS_PER_DEGREE
        if (Math.hypot(north, east) <= alarmRadiusMeters) {
          sightings += 1
        }
      }
    }
  }

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [contributor],
    poiTypes: 'Hazard',
    now: clock.now
  })

  const speed = speedKnots * METERS_PER_SECOND_PER_KNOT
  // From well before the hazard to well past it, one fix a second.
  for (let second = 0; second <= 10_000 / speed; second += 1) {
    clock.advance(1000)
    mockApp.emit(eastAt((second + phaseSeconds) * speed))
    await flush()
    await flush()
  }
  monitor.stop()
  return { sightings, errors: mockApp.errorMessages() }
}

test('a hazard passing abeam is evaluated inside the radius at every tick phase', async () => {
  // 20 kt past a hazard 450 m off the track, with the default 500 m radius.
  // The hazard is inside the radius for 436 m of track, which is less than the
  // 617 m the vessel covers in one minute, so a once-a-minute evaluation can
  // straddle the whole pass.
  for (let phase = 0; phase < 12; phase += 1) {
    const { sightings } = await runPast({
      speedKnots: 20,
      abeamMeters: 450,
      alarmRadiusMeters: 500,
      phaseSeconds: phase * 5
    })
    assert.ok(sightings > 0, `no evaluation caught the hazard at phase ${phase}`)
  }
})

test('a hazard dead ahead is evaluated inside the radius at every tick phase', async () => {
  // 35 kt straight at a hazard: 1080 m covered in a minute against a 1000 m
  // chord through the alarm zone.
  for (let phase = 0; phase < 12; phase += 1) {
    const { sightings } = await runPast({
      speedKnots: 35,
      abeamMeters: 0,
      alarmRadiusMeters: 500,
      phaseSeconds: phase * 5
    })
    assert.ok(sightings > 0, `no evaluation caught the hazard at phase ${phase}`)
  }
})

test('outrunning the sampling for a tight alarm radius is reported, not silent', async () => {
  const { errors } = await runPast({
    speedKnots: 60,
    abeamMeters: 0,
    alarmRadiusMeters: 10,
    phaseSeconds: 0
  })

  const gap = errors.find((message) => message.includes('between alarm checks'))
  assert.ok(gap !== undefined, 'the coverage gap is reported')
  assert.ok(gap.includes('10 m'), 'the report names the radius that cannot be sampled')
})

test('an alarm radius the sampling cannot resolve is reported at startup', () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const contributor: PositionScanContributor = {
    poiTypes: ['Hazard'],
    alarmRadiusMeters: 1,
    buildFetchBox: () => SCAN_BOX,
    evaluate: () => {}
  }

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [contributor],
    poiTypes: 'Hazard',
    now: createClock().now
  })

  const reported = mockApp.errorMessages().find((message) => message.includes('narrower than the sampling'))
  assert.ok(reported !== undefined, 'a radius that can never be honored is called out at startup')
  monitor.stop()
})

test('evaluations between list requests replay the last result without refetching', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()
  const evaluations: PoiSummary[][] = []
  const contributor: PositionScanContributor = {
    poiTypes: ['Hazard'],
    alarmRadiusMeters: 500,
    buildFetchBox: () => SCAN_BOX,
    evaluate: (_position, pois) => { evaluations.push(pois) }
  }
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [contributor],
    poiTypes: 'Hazard',
    now: clock.now
  })

  mockApp.emit(eastAt(0))
  await flush()
  assert.equal(mockClient.calls.length, 1)
  assert.equal(evaluations.length, 1)

  // Two more fixes, 200 m apart, well inside the one-minute refetch interval.
  for (const metersEast of [200, 400]) {
    clock.advance(10_000)
    mockApp.emit(eastAt(metersEast))
    await flush()
  }

  assert.equal(mockClient.calls.length, 1, 'no extra upstream traffic')
  assert.equal(evaluations.length, 3, 'the alarms still ran on both fixes')
  assert.deepEqual(evaluations[2], [HAZARD], 'against the last result')

  monitor.stop()
})

test('leaving the water the last list covered forces a refetch before the interval', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()
  const contributor: PositionScanContributor = {
    poiTypes: ['Hazard'],
    // A 500 m radius fetches a 2000 m box, so the box stops reaching the alarm
    // zone 1500 m from the position it was built around.
    alarmRadiusMeters: 500,
    buildFetchBox: () => SCAN_BOX,
    evaluate: () => {}
  }

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [contributor],
    poiTypes: 'Hazard',
    now: clock.now
  })

  mockApp.emit(eastAt(0))
  await flush()
  assert.equal(mockClient.calls.length, 1)

  clock.advance(1000)
  mockApp.emit(eastAt(1400))
  await flush()
  assert.equal(mockClient.calls.length, 1, 'still covered, so the interval gate holds')

  clock.advance(1000)
  mockApp.emit(eastAt(1600))
  await flush()
  assert.equal(mockClient.calls.length, 2, 'past the covered distance the interval is overridden')

  monitor.stop()
})

test('a contributor with no alarm radius keeps the plain tick cadence', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()
  const scan = createMockContributor(['Hazard'], SCAN_BOX)

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [scan.contributor],
    poiTypes: 'Hazard',
    now: clock.now
  })

  mockApp.emit(eastAt(0))
  await flush()
  for (const metersEast of [5000, 10_000, 15_000]) {
    clock.advance(1000)
    mockApp.emit(eastAt(metersEast))
    await flush()
  }

  assert.equal(mockClient.calls.length, 1, 'no coverage override without a declared radius')
  assert.equal(scan.evaluations().length, 1, 'and no evaluation between list requests')

  monitor.stop()
})

test('a replayed result keeps the time its own list request landed', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()
  const stamps: number[] = []
  const contributor: PositionScanContributor = {
    poiTypes: ['Hazard'],
    alarmRadiusMeters: 500,
    buildFetchBox: () => SCAN_BOX,
    evaluate: (_position, _pois, listFetchedAt) => { stamps.push(listFetchedAt) }
  }
  mockClient.setPois([HAZARD])

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [contributor],
    poiTypes: 'Hazard',
    now: clock.now
  })

  const fetchedAt = clock.now()
  mockApp.emit(eastAt(0))
  await flush()

  clock.advance(20_000)
  mockApp.emit(eastAt(300))
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the second fix replays rather than refetches')
  assert.deepEqual(stamps, [fetchedAt, fetchedAt],
    'the replay reports the request time, so a held alarm still ages out')

  monitor.stop()
})

test('a replay carries exactly the points each zone contributor would see in the full list', async () => {
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const clock = createClock()

  /** A zone contributor recording the list it was handed on each evaluation. */
  function zoneContributor (poiTypes: readonly PoiType[]): {
    contributor: PositionScanContributor
    lists: () => PoiSummary[][]
  } {
    const lists: PoiSummary[][] = []
    return {
      contributor: {
        poiTypes,
        alarmRadiusMeters: 500,
        buildFetchBox: () => SCAN_BOX,
        evaluate: (_position, pois) => { lists.push(pois) }
      },
      lists: () => lists
    }
  }

  // The two shipped zone contributors: the proximity alarm reads Hazard, the
  // bridge air-draft check reads Bridge. The combined list carries the other
  // outputs' types too, and none of those has a between-request reader.
  const hazardScan = zoneContributor(['Hazard'])
  const bridgeScan = zoneContributor(['Bridge'])
  const combined = [
    poiSummary('h1', 'Hazard', 'Rock', eastAt(50)),
    poiSummary('m1', 'Marina', 'Town quay', eastAt(60)),
    poiSummary('b1', 'Bridge', 'Low bridge', eastAt(70)),
    poiSummary('l1', 'Lock', 'Canal lock', eastAt(80)),
    poiSummary('h2', 'Hazard', 'Wreck', eastAt(90)),
    poiSummary('a1', 'Anchorage', 'The pool', eastAt(100)),
    poiSummary('b2', 'Bridge', 'Swing bridge', eastAt(110))
  ]
  mockClient.setPois(combined)

  const monitor = createPositionMonitor({
    app: mockApp.app,
    client: mockClient.client,
    contributors: [hazardScan.contributor, bridgeScan.contributor],
    poiTypes: 'Hazard,Bridge,Marina,Lock,Anchorage',
    now: clock.now
  })

  mockApp.emit(eastAt(0))
  await flush()

  clock.advance(20_000)
  mockApp.emit(eastAt(300))
  await flush()

  assert.equal(mockClient.calls.length, 1, 'the second fix replays rather than refetches')

  // The property the narrowed replay has to hold: whatever a contributor would
  // pick out of the tick's full list, it picks the same points out of the
  // replay, in the same order.
  for (const [scan, poiTypes] of [[hazardScan, ['Hazard']], [bridgeScan, ['Bridge']]] as const) {
    const [tickList, replayList] = scan.lists()
    assert.equal(scan.lists().length, 2, 'one tick evaluation and one replay')
    const readable = (pois: PoiSummary[]): PoiSummary[] =>
      pois.filter((poi) => (poiTypes as readonly PoiType[]).includes(poi.type))
    assert.deepEqual(readable(replayList), readable(tickList),
      `a ${poiTypes[0]} reader sees the same points either way`)
    assert.ok(readable(tickList).length > 0, 'and the comparison is not vacuous')
  }

  // Only the types the two of them read survive, so the points belonging to
  // outputs that never replay are not carried between ticks.
  const [, replayList] = hazardScan.lists()
  assert.deepEqual(replayList.map((poi) => poi.id), ['h1', 'b1', 'h2', 'b2'])
  assert.ok(replayList.length < combined.length, 'the replay really is narrower')

  monitor.stop()
})

test('no live subscription survives a contributor that throws during construction', () => {
  // The plugin shell catches a failed monitor construction, reports it as a
  // plugin error, and leaves the run going, so a construction that fails must
  // not leave a live position handler behind: every disable-and-re-enable
  // cycle would stack another one. Asserted as "nothing live", not as
  // "unsubscribed", so it holds however the monitor achieves it.
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const good = createMockContributor(['Hazard'], SCAN_BOX)
  const broken: PositionScanContributor = {
    poiTypes: ['Hazard'],
    setScanRequester: () => { throw new Error('broken contributor') },
    buildFetchBox: () => SCAN_BOX,
    evaluate: () => {}
  }

  assert.throws(
    () => createPositionMonitor({
      app: mockApp.app,
      client: mockClient.client,
      contributors: [good.contributor, broken],
      poiTypes: 'Hazard',
      now: createClock().now
    }),
    /broken contributor/
  )

  assert.equal(mockApp.liveSubscriptions(), 0, 'no position subscription is left live')
  mockApp.emit({ latitude: 10, longitude: 20 })
  assert.equal(mockClient.calls.length, 0, 'a later fix drives no work')
})

test('no live subscription survives a throwing logger during construction', () => {
  // `app.debug` and `app.error` are the HOST's functions, not this module's,
  // so they can fail too. The same property has to hold for them as for a
  // throwing contributor, which is why construction takes its subscription
  // last rather than guarding the steps before it.
  const mockApp = createMockApp()
  const mockClient = createMockClient()
  const throwingApp: MonitorApp = {
    ...mockApp.app,
    error: () => { throw new Error('logger exploded') }
  }
  const scan = createMockContributor(['Hazard'], SCAN_BOX)
  // A radius below the sampling floor is the branch that reaches app.error.
  const tooTight: PositionScanContributor = { ...scan.contributor, alarmRadiusMeters: 1 }

  assert.throws(
    () => createPositionMonitor({
      app: throwingApp,
      client: mockClient.client,
      contributors: [tooTight],
      poiTypes: 'Hazard',
      now: createClock().now
    }),
    /logger exploded/
  )

  assert.equal(mockApp.liveSubscriptions(), 0, 'no position subscription is left live')
  mockApp.emit({ latitude: 10, longitude: 20 })
  assert.equal(mockClient.calls.length, 0, 'a later fix drives no work')
})
