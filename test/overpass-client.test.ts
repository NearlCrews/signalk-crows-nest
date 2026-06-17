import test from 'node:test'
import assert from 'node:assert/strict'
import { createOverpassClient, type RateLimitOptions } from '../src/inputs/openseamap/overpass-client.js'
import type { Bbox } from '../src/shared/types.js'
import { jsonResponse, silentLog, withMockFetch } from './helpers.js'

/** Fast rate-limit settings so the retry tests do not sleep for whole seconds. */
const fastLimits: Partial<RateLimitOptions> = {
  minDelayMs: 0,
  backoffBaseMs: 1,
  maxBackoffMs: 4,
  maxRetries: 2
}

const endpoint = 'https://overpass.test/api/interpreter'
const sampleBbox: Bbox = { north: 1, south: 0, east: 1, west: 0 }

test('listPointsOfInterest renders the bbox in south,west,north,east order', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      const body = String(calls.lastInit?.body)
      assert.ok(body.includes('[bbox:0,0,1,1]'), `expected the bbox in S,W,N,E order, got ${body}`)
      assert.ok(body.includes('"seamark:type"~"^(rock)$"'), 'expected the seamark regex in the query')
    }
  )
})

test('listCoastlineWays issues a coastline out-geom query and parses geometry into points', async () => {
  await withMockFetch(
    () => jsonResponse({
      elements: [
        {
          type: 'way',
          id: 10,
          geometry: [{ lat: 50, lon: 1 }, { lat: 50.1, lon: 1.1 }, { lat: 50.2, lon: 1.2 }]
        },
        // A way with a single valid vertex is dropped: a coastline segment
        // needs at least two points.
        { type: 'way', id: 11, geometry: [{ lat: 51, lon: 2 }] }
      ]
    }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      const ways = await client.listCoastlineWays(sampleBbox)
      const body = String(calls.lastInit?.body)
      assert.ok(body.includes('"natural"="coastline"'), `expected a coastline query, got ${body}`)
      assert.ok(body.includes('out geom;'), `expected an out geom query, got ${body}`)
      // Points are ordered [lon, lat]; the single-vertex way is dropped.
      assert.deepEqual(ways, [
        { points: [[1, 50], [1.1, 50.1], [1.2, 50.2]] }
      ])
    }
  )
})

test('an already-aborted caller signal aborts the request', async () => {
  await withMockFetch(
    (_callIndex, init) => {
      if (init?.signal?.aborted === true) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }
      return jsonResponse({ elements: [] })
    },
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, { ...fastLimits, maxRetries: 0 })
      await assert.rejects(
        () => client.listCoastlineWays(sampleBbox, AbortSignal.abort()),
        (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
      )
      // The combined signal handed to fetch carried the caller's aborted state.
      assert.equal(calls.lastInit?.signal?.aborted, true)
    }
  )
})

test('a caller abort rejects after exactly one attempt, not the whole retry budget', async () => {
  await withMockFetch(
    (_callIndex, init) => {
      if (init?.signal?.aborted === true) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }
      return jsonResponse({ elements: [] })
    },
    async (calls) => {
      // maxRetries 3 with a multi-second backoff: were the caller abort not a
      // retry short-circuit, this would make four attempts with backoff waits
      // between them rather than rejecting at once.
      const retrying: Partial<RateLimitOptions> = {
        ...fastLimits, maxRetries: 3, backoffBaseMs: 5000, maxBackoffMs: 5000
      }
      const client = createOverpassClient(endpoint, silentLog, retrying)
      await assert.rejects(
        () => client.listCoastlineWays(sampleBbox, AbortSignal.abort()),
        (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
      )
      assert.equal(calls.count, 1, 'a caller abort must not retry')
    }
  )
})

test('every request sends a descriptive User-Agent header', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      const headers = calls.lastInit?.headers as Record<string, string>
      assert.ok(
        headers['User-Agent'].includes('signalk-crows-nest'),
        'expected a plugin-identifying User-Agent'
      )
    }
  )
})

test('an oversized bounding box is clamped around its center', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      // A 10-degree box is clamped to the 2-degree maximum span: centered on 5,
      // that is the range 4 to 6 on each edge.
      await client.listPointsOfInterest({ north: 10, south: 0, east: 10, west: 0 }, '^(rock)$')
      const body = String(calls.lastInit?.body)
      assert.ok(body.includes('[bbox:4,4,6,6]'), `expected the box clamped to a 2-degree span, got ${body}`)
    }
  )
})

test('a successful response is parsed into normalized elements', async () => {
  await withMockFetch(
    () => jsonResponse({
      elements: [
        { type: 'node', id: 1, lat: 50, lon: 1, tags: { 'seamark:type': 'rock' } },
        { type: 'way', id: 2, center: { lat: 51, lon: 2 }, tags: { leisure: 'marina' } },
        { type: 'node', id: 3, tags: {} }
      ]
    }),
    async () => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      // The third element has no position and is dropped.
      assert.deepEqual(result, [
        { type: 'node', id: 1, tags: { 'seamark:type': 'rock' }, position: { latitude: 50, longitude: 1 } },
        { type: 'way', id: 2, tags: { leisure: 'marina' }, position: { latitude: 51, longitude: 2 } }
      ])
    }
  )
})

test('a 429 with Retry-After is retried and then succeeds', async () => {
  await withMockFetch(
    (callIndex) => callIndex === 0
      ? jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '0' })
      : jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2, 'expected one retry after the 429')
    }
  )
})

test('listPointsOfInterest rejects on a non-ok HTTP status', async () => {
  await withMockFetch(
    () => jsonResponse({ message: 'bad request' }, 400),
    async () => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      await assert.rejects(
        () => client.listPointsOfInterest(sampleBbox, '^(rock)$'),
        /list request failed: 400/
      )
    }
  )
})

test('getById queries by typed id and returns the single element', async () => {
  await withMockFetch(
    () => jsonResponse({
      elements: [
        { type: 'node', id: 123, lat: 12, lon: -70, tags: { 'seamark:type': 'wreck' } }
      ]
    }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      const element = await client.getById('node/123')
      assert.deepEqual(element, {
        type: 'node', id: 123, tags: { 'seamark:type': 'wreck' }, position: { latitude: 12, longitude: -70 }
      })
      assert.ok(String(calls.lastInit?.body).includes('node(id:123)'), 'expected a by-id query')
    }
  )
})

test('getById resolves undefined when the element no longer exists', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async () => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      assert.equal(await client.getById('way/999'), undefined)
    }
  )
})

test('getById rejects a malformed typed id without issuing a request', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      await assert.rejects(() => client.getById('not-a-real-id'), /Invalid OSM element id/)
      assert.equal(calls.count, 0, 'expected no request for a malformed id')
    }
  )
})

test('close() rejects a new request without touching the network', async () => {
  await withMockFetch(
    (_callIndex, init) => {
      if (init?.signal?.aborted === true) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }
      return jsonResponse({ elements: [] })
    },
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      client.close()
      // The closed queue rejects at enqueue, before any fetch or retry runs.
      await assert.rejects(() => client.listPointsOfInterest(sampleBbox, '^(rock)$'), /client closed/)
      assert.equal(calls.count, 0, 'expected no fetch once the client is closed')
    }
  )
})

/** A primary endpoint and one fallback mirror, tried in this order. */
const failoverEndpoints = [
  'https://primary.test/api/interpreter',
  'https://mirror.test/api/interpreter'
]

test('a single endpoint string keeps the prior single-endpoint behavior', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(endpoint, silentLog, fastLimits)
      await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      assert.equal(calls.count, 1)
      assert.deepEqual(calls.urls, [endpoint])
    }
  )
})

test('a non-ok status on the primary fails over to the next endpoint', async () => {
  await withMockFetch(
    (callIndex) => callIndex === 0
      ? jsonResponse({ error: 'forbidden' }, 403)
      : jsonResponse({ elements: [{ type: 'node', id: 1, lat: 50, lon: 1, tags: { 'seamark:type': 'rock' } }] }),
    async (calls) => {
      const client = createOverpassClient(failoverEndpoints, silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      assert.equal(result.length, 1, 'the fallback endpoint result is returned')
      assert.equal(calls.count, 2, 'the primary is tried once, then the fallback')
      assert.deepEqual(calls.urls, failoverEndpoints, 'endpoints are tried in order')
    }
  )
})

test('a network error on the primary fails over to the next endpoint', async () => {
  const noRetry: Partial<RateLimitOptions> = { ...fastLimits, maxRetries: 0 }
  await withMockFetch(
    (callIndex) => {
      if (callIndex === 0) throw new Error('connection refused')
      return jsonResponse({ elements: [] })
    },
    async (calls) => {
      const client = createOverpassClient(failoverEndpoints, silentLog, noRetry)
      await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      assert.equal(calls.count, 2)
      assert.deepEqual(calls.urls, failoverEndpoints)
    }
  )
})

test('the fallback is not tried when the primary succeeds', async () => {
  await withMockFetch(
    () => jsonResponse({ elements: [] }),
    async (calls) => {
      const client = createOverpassClient(failoverEndpoints, silentLog, fastLimits)
      await client.listPointsOfInterest(sampleBbox, '^(rock)$')
      assert.equal(calls.count, 1, 'a healthy primary short-circuits the fallback')
      assert.deepEqual(calls.urls, [failoverEndpoints[0]])
    }
  )
})

test('the query rejects when every endpoint fails', async () => {
  await withMockFetch(
    () => jsonResponse({ error: 'forbidden' }, 403),
    async (calls) => {
      const client = createOverpassClient(failoverEndpoints, silentLog, fastLimits)
      await assert.rejects(() => client.listPointsOfInterest(sampleBbox, '^(rock)$'))
      assert.equal(calls.count, 2, 'both endpoints are tried before giving up')
    }
  )
})
