import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createActiveCaptainSource } from '../src/inputs/active-captain/active-captain-source.js'
import { HttpError } from '../src/inputs/active-captain/active-captain-client.js'
import type {
  ActiveCaptainClient,
  ClientPoiSummary
} from '../src/inputs/active-captain/active-captain-client.js'
import type { PoiDetails } from '../src/inputs/active-captain/active-captain-types.js'

const sampleDetails = {
  pointOfInterest: {
    id: 1,
    name: 'X',
    poiType: 'Marina',
    mapLocation: { latitude: 1, longitude: 2 },
    dateLastModified: '2020-01-01T00:00:00.000'
  }
} as unknown as PoiDetails

/** Create a fresh, isolated temp directory so a test never inherits another's
 *  poi-cache.json. The returned `cleanup` removes it. */
function makeTempDir (): { dataDir: string, cleanup: () => void } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crows-nest-'))
  return {
    dataDir,
    cleanup: () => { fs.rmSync(dataDir, { recursive: true, force: true }) }
  }
}

/** A client whose detail fetches are counted and can be made to reject. */
function fakeClient (overrides: Partial<ActiveCaptainClient> = {}): {
  client: ActiveCaptainClient
  detailCalls: () => number
} {
  let calls = 0
  const client: ActiveCaptainClient = {
    listPointsOfInterest: async (): Promise<ClientPoiSummary[]> =>
      [{ id: '1', name: 'A', type: 'Marina', position: { latitude: 0, longitude: 0 } }],
    pointOfInterestDetails: async (): Promise<PoiDetails> => {
      calls++
      return sampleDetails
    },
    close: () => {},
    ...overrides
  }
  return { client, detailCalls: () => calls }
}

/** Counting spies for the status recorder and the SignalK app. */
function spies () {
  const calls = { detailSuccess: 0, recordError: 0, setPluginError: 0 }
  return {
    calls,
    status: {
      recordDetailSuccess: () => { calls.detailSuccess++ },
      recordError: () => { calls.recordError++ }
    } as never,
    app: {
      setPluginError: () => { calls.setPluginError++ },
      debug: () => {}
    } as never
  }
}

test('getDetails returns detail through the cache', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const source = createActiveCaptainSource({
      client: fakeClient().client,
      cachingDurationMinutes: 60,
      dataDir,
      ...spies()
    })
    const view = await source.getDetails('1')
    assert.equal(view.name, 'X')
    assert.equal(view.type, 'Marina')
    assert.equal(view.source, 'activecaptain')
    assert.equal(view.url, 'https://activecaptain.garmin.com/en-US/pois/1')
    // The description no longer carries an inline attribution footer; the
    // credit rides on `view.attribution` and on the note's structured
    // `properties.attribution`.
    assert.equal(view.attribution, 'Data from Garmin ActiveCaptain')
    assert.doesNotMatch(view.description ?? '', /Data sourced from/)
    assert.equal(source.id, 'activecaptain')
    source.close()
  } finally {
    cleanup()
  }
})

test('getDetails serves a second call from the cache without a second round-trip', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client, detailCalls } = fakeClient()
    const source = createActiveCaptainSource({
      client,
      cachingDurationMinutes: 60,
      dataDir,
      ...spies()
    })
    await source.getDetails('1')
    await source.getDetails('1')
    assert.equal(detailCalls(), 1)
    source.close()
  } finally {
    cleanup()
  }
})

test('listPointsOfInterest delegates to the client', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const source = createActiveCaptainSource({
      client: fakeClient().client,
      cachingDurationMinutes: 60,
      dataDir,
      ...spies()
    })
    const list = await source.listPointsOfInterest(
      { north: 1, south: 0, east: 1, west: 0 }, 'Marina')
    assert.equal(list.length, 1)
    assert.equal(list[0].source, 'activecaptain')
    assert.equal(list[0].url, 'https://activecaptain.garmin.com/en-US/pois/1')
    assert.equal(list[0].skIcon, 'marina',
      'the marina type rides the Freeboard-registered marina icon')
    source.close()
  } finally {
    cleanup()
  }
})

test('listPointsOfInterest tags each POI type with a Freeboard-registered skIcon', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client } = fakeClient({
      listPointsOfInterest: async (): Promise<ClientPoiSummary[]> => [
        { id: '1', name: 'M', type: 'Marina', position: { latitude: 0, longitude: 0 } },
        { id: '2', name: 'A', type: 'Anchorage', position: { latitude: 0, longitude: 0 } },
        { id: '3', name: 'H', type: 'Hazard', position: { latitude: 0, longitude: 0 } },
        { id: '4', name: 'B', type: 'Business', position: { latitude: 0, longitude: 0 } },
        { id: '5', name: 'R', type: 'BoatRamp', position: { latitude: 0, longitude: 0 } },
        { id: '6', name: 'Br', type: 'Bridge', position: { latitude: 0, longitude: 0 } },
        { id: '7', name: 'D', type: 'Dam', position: { latitude: 0, longitude: 0 } },
        { id: '8', name: 'F', type: 'Ferry', position: { latitude: 0, longitude: 0 } },
        { id: '9', name: 'I', type: 'Inlet', position: { latitude: 0, longitude: 0 } },
        { id: '10', name: 'L', type: 'Lock', position: { latitude: 0, longitude: 0 } },
        { id: '11', name: 'LK', type: 'LocalKnowledge', position: { latitude: 0, longitude: 0 } },
        { id: '12', name: 'N', type: 'Navigational', position: { latitude: 0, longitude: 0 } },
        { id: '13', name: 'Air', type: 'Airport', position: { latitude: 0, longitude: 0 } }
      ]
    })
    const source = createActiveCaptainSource({
      client,
      cachingDurationMinutes: 60,
      dataDir,
      ...spies()
    })
    const list = await source.listPointsOfInterest(
      { north: 1, south: 0, east: 1, west: 0 }, '')
    const byId = new Map(list.map((p) => [p.id, p.skIcon]))
    // Direct lowercase matches.
    assert.equal(byId.get('1'), 'marina')
    assert.equal(byId.get('2'), 'anchorage')
    assert.equal(byId.get('3'), 'hazard')
    assert.equal(byId.get('4'), 'business')
    assert.equal(byId.get('5'), 'boatramp')
    assert.equal(byId.get('6'), 'bridge')
    assert.equal(byId.get('7'), 'dam')
    assert.equal(byId.get('8'), 'ferry')
    assert.equal(byId.get('9'), 'inlet')
    assert.equal(byId.get('10'), 'lock')
    // The three formerly-broken types now ride Freeboard-registered icons.
    assert.equal(byId.get('11'), 'notice-to-mariners',
      'LocalKnowledge -> notice-to-mariners (no localknowledge icon in Freeboard)')
    assert.equal(byId.get('12'), 'navigation-structure',
      'Navigational -> navigation-structure (no navigational icon in Freeboard)')
    assert.equal(byId.get('13'), 'notice-to-mariners',
      'Airport -> notice-to-mariners (no airport icon in Freeboard)')
    source.close()
  } finally {
    cleanup()
  }
})

test('listPointsOfInterest applies the minimum-rating filter to its own results', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client } = fakeClient({
      listPointsOfInterest: async (): Promise<ClientPoiSummary[]> => [
        { id: '1', name: 'Good', type: 'Marina', position: { latitude: 0, longitude: 0 }, rating: 4.5, reviewCount: 10 },
        { id: '2', name: 'Poor', type: 'Marina', position: { latitude: 0, longitude: 0 }, rating: 1, reviewCount: 3 },
        { id: '3', name: 'Reef', type: 'Hazard', position: { latitude: 0, longitude: 0 } }
      ]
    })
    const source = createActiveCaptainSource({
      client,
      cachingDurationMinutes: 60,
      minimumRating: 3,
      dataDir,
      ...spies()
    })
    const list = await source.listPointsOfInterest(
      { north: 1, south: 0, east: 1, west: 0 }, 'Marina')
    // The low-rated marina is dropped; the high-rated marina and the
    // non-ratable hazard both survive the threshold.
    assert.deepEqual(list.map((poi) => poi.id), ['1', '3'])
    source.close()
  } finally {
    cleanup()
  }
})

test('a 404 detail failure records a detail success, not an error', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client } = fakeClient({
      pointOfInterestDetails: async (): Promise<PoiDetails> => {
        throw new HttpError('not found', 404)
      }
    })
    const spy = spies()
    const source = createActiveCaptainSource({
      client,
      cachingDurationMinutes: 60,
      dataDir,
      status: spy.status,
      app: spy.app
    })
    await assert.rejects(source.getDetails('1'))
    assert.equal(spy.calls.detailSuccess, 1)
    assert.equal(spy.calls.recordError, 0)
    assert.equal(spy.calls.setPluginError, 0)
    source.close()
  } finally {
    cleanup()
  }
})

test('a non-404 detail failure records an error without escalating to the plugin banner', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client } = fakeClient({
      pointOfInterestDetails: async (): Promise<PoiDetails> => {
        throw new HttpError('boom', 500)
      }
    })
    const spy = spies()
    const source = createActiveCaptainSource({
      client,
      cachingDurationMinutes: 60,
      dataDir,
      status: spy.status,
      app: spy.app
    })
    await assert.rejects(source.getDetails('1'))
    assert.equal(spy.calls.recordError, 1)
    // The per-source status row is the right surface; the server-wide banner
    // is reserved for start errors, so a transient per-POI failure must not
    // replace it.
    assert.equal(spy.calls.setPluginError, 0)
    assert.equal(spy.calls.detailSuccess, 0)
    source.close()
  } finally {
    cleanup()
  }
})

/** Build a client whose detail fetch always rejects with an AbortError. */
function abortingClient (): ActiveCaptainClient {
  return fakeClient({
    pointOfInterestDetails: async (): Promise<PoiDetails> => {
      const abort = new Error('The operation was aborted')
      abort.name = 'AbortError'
      throw abort
    }
  }).client
}

test('an aborted detail fetch after close() records neither a success nor an error', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const spy = spies()
    const source = createActiveCaptainSource({
      client: abortingClient(),
      cachingDurationMinutes: 60,
      dataDir,
      status: spy.status,
      app: spy.app
    })
    // close() aborts the previous run's in-flight fetches; that abort is
    // benign and must not clobber a later run's status.
    source.close()
    await assert.rejects(source.getDetails('1'))
    assert.equal(spy.calls.detailSuccess, 0)
    assert.equal(spy.calls.recordError, 0)
    assert.equal(spy.calls.setPluginError, 0)
  } finally {
    cleanup()
  }
})

test('an aborted detail fetch while the source is running is recorded as an error', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const spy = spies()
    const source = createActiveCaptainSource({
      client: abortingClient(),
      cachingDurationMinutes: 60,
      dataDir,
      status: spy.status,
      app: spy.app
    })
    // An abort that is NOT from the plugin's own close() is a genuine failure
    // and must be surfaced, not silently swallowed.
    await assert.rejects(source.getDetails('1'))
    assert.equal(spy.calls.detailSuccess, 0)
    assert.equal(spy.calls.recordError, 1)
    assert.equal(spy.calls.setPluginError, 0)
    source.close()
  } finally {
    cleanup()
  }
})

test('a load that resolves after close() is not persisted to disk', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client, detailCalls } = fakeClient()
    const source = createActiveCaptainSource({
      client,
      cachingDurationMinutes: 60,
      dataDir,
      ...spies()
    })
    source.close()
    // The load still resolves, but its run is torn down: nothing reaches the
    // on-disk store.
    await source.getDetails('1')
    assert.equal(detailCalls(), 1)

    // A fresh source over the same directory finds nothing to hydrate, so it
    // fetches the detail itself rather than serving a stale persisted copy.
    const { client: freshClient, detailCalls: freshDetailCalls } = fakeClient()
    const freshSource = createActiveCaptainSource({
      client: freshClient,
      cachingDurationMinutes: 60,
      dataDir,
      ...spies()
    })
    await freshSource.getDetails('1')
    assert.equal(freshDetailCalls(), 1, 'expected nothing persisted from the closed run')
    freshSource.close()
  } finally {
    cleanup()
  }
})
