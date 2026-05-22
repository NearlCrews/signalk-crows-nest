import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createActiveCaptainSource } from '../src/inputs/active-captain/active-captain-source.js'
import { HttpError } from '../src/inputs/active-captain/active-captain-client.js'
import type { ActiveCaptainClient } from '../src/inputs/active-captain/active-captain-client.js'
import type { PoiDetails, PoiSummary } from '../src/shared/types.js'

const sampleDetails = { pointOfInterest: { name: 'X' } } as unknown as PoiDetails

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
    listPointsOfInterest: async (): Promise<PoiSummary[]> =>
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
    assert.equal((await source.getDetails('1')).pointOfInterest.name, 'X')
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

test('a non-404 detail failure records an error and sets the plugin error', async () => {
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
    assert.equal(spy.calls.setPluginError, 1)
    assert.equal(spy.calls.detailSuccess, 0)
    source.close()
  } finally {
    cleanup()
  }
})

test('an aborted detail fetch records neither a success nor an error', async () => {
  const { dataDir, cleanup } = makeTempDir()
  try {
    const { client } = fakeClient({
      pointOfInterestDetails: async (): Promise<PoiDetails> => {
        const abort = new Error('The operation was aborted')
        abort.name = 'AbortError'
        throw abort
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
    assert.equal(spy.calls.detailSuccess, 0)
    assert.equal(spy.calls.recordError, 0)
    assert.equal(spy.calls.setPluginError, 0)
    source.close()
  } finally {
    cleanup()
  }
})
