import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmodnetClient } from '../src/route-draft/emodnet/emodnet-client.js'
import type { Position } from '../src/shared/types.js'

const FROM: Position = { latitude: 53, longitude: 4 }
const TO: Position = { latitude: 53, longitude: 4.2 }

test('builds a lon-lat LINESTRING and parses the non-null samples', async () => {
  let requested = ''
  const client = createEmodnetClient({
    requestText: async (url) => { requested = url; return { status: 200, body: '[-10.5, null, -8.2]', headers: {} } }
  })
  const result = await client.depthProfile(FROM, TO)
  assert.match(decodeURIComponent(requested), /LINESTRING\(4 53,4\.2 53\)/)
  assert.deepEqual(result.samples, [-10.5, -8.2])
  assert.equal(result.hadGap, true)
})

test('a profile with no nulls has hadGap false', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 200, body: '[-10.5, -8.2]', headers: {} }) })
  const result = await client.depthProfile(FROM, TO)
  assert.deepEqual(result.samples, [-10.5, -8.2])
  assert.equal(result.hadGap, false)
})

test('an all-null array is no data (empty samples, hadGap false)', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 200, body: '[null, null]', headers: {} }) })
  const result = await client.depthProfile(FROM, TO)
  assert.deepEqual(result.samples, [])
  assert.equal(result.hadGap, false)
})

test('a 204 is no data', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 204, body: '', headers: {} }) })
  assert.deepEqual(await client.depthProfile(FROM, TO), { samples: [], hadGap: false })
})

test('a 500 rejects', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 500, body: 'err', headers: {} }) })
  await assert.rejects(() => client.depthProfile(FROM, TO))
})

test('non-JSON rejects', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 200, body: 'not json', headers: {} }) })
  await assert.rejects(() => client.depthProfile(FROM, TO))
})

test('a non-2xx with an empty body rejects (not no-data)', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 503, body: '', headers: {} }) })
  await assert.rejects(() => client.depthProfile(FROM, TO))
})

test('a non-array JSON value rejects with the did-not-return-an-array error', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 200, body: '{}', headers: {} }) })
  await assert.rejects(() => client.depthProfile(FROM, TO), /did not return an array/)
})

test('threads the abort signal to the transport', async () => {
  let received: AbortSignal | undefined
  const client = createEmodnetClient({
    requestText: async (_u, _h, _t, _l, signal) => { received = signal; return { status: 200, body: '[-5]', headers: {} } }
  })
  const ctrl = new AbortController()
  await client.depthProfile(FROM, TO, ctrl.signal)
  assert.equal(received, ctrl.signal)
})
