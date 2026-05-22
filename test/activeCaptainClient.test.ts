import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveCaptainClient, type RateLimitOptions } from '../src/inputs/active-captain/active-captain-client.js'
import type { Bbox } from '../src/shared/types.js'

/** A logger that discards output, keeping test runs quiet. */
const silentLog = { debug: (): void => {}, error: (): void => {} }

/** Fast rate-limit settings so the retry tests do not sleep for whole seconds. */
const fastLimits: Partial<RateLimitOptions> = {
  minDelayMs: 0,
  backoffBaseMs: 1,
  maxBackoffMs: 4,
  maxRetries: 2
}

const sampleBbox: Bbox = { north: 1, south: 0, east: 1, west: 0 }

/** Build a JSON Response with the given status and optional headers. */
function jsonResponse (body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/**
 * Swap in a stubbed global fetch for the duration of fn, then restore it. The
 * stub records every call so tests can assert on retry behavior.
 */
async function withMockFetch (
  handler: (callIndex: number) => Response | Promise<Response>,
  fn: (calls: { count: number }) => Promise<void>
): Promise<void> {
  const original = globalThis.fetch
  const calls = { count: 0 }
  globalThis.fetch = (async (): Promise<Response> => {
    const callIndex = calls.count
    calls.count++
    return handler(callIndex)
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = original
  }
}

test('listPointsOfInterest normalizes the wire response', async () => {
  await withMockFetch(
    () => jsonResponse({
      pointsOfInterest: [
        {
          id: '42',
          poiType: 'Marina',
          mapLocation: { latitude: 12.5, longitude: -70.1 },
          name: 'Test Marina'
        }
      ]
    }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [
        {
          id: '42',
          type: 'Marina',
          position: { latitude: 12.5, longitude: -70.1 },
          name: 'Test Marina'
        }
      ])
    }
  )
})

test('listPointsOfInterest carries the reviewSummary rating into the summary', async () => {
  await withMockFetch(
    () => jsonResponse({
      pointsOfInterest: [
        {
          id: '42',
          poiType: 'Marina',
          mapLocation: { latitude: 12.5, longitude: -70.1 },
          name: 'Rated Marina',
          reviewSummary: { averageRating: 4.5, numberOfReviews: 12 }
        },
        {
          id: '43',
          poiType: 'Marina',
          mapLocation: { latitude: 12.6, longitude: -70.2 },
          name: 'Unrated Marina'
        }
      ]
    }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [
        {
          id: '42',
          type: 'Marina',
          position: { latitude: 12.5, longitude: -70.1 },
          name: 'Rated Marina',
          rating: 4.5,
          reviewCount: 12
        },
        {
          id: '43',
          type: 'Marina',
          position: { latitude: 12.6, longitude: -70.2 },
          name: 'Unrated Marina'
        }
      ])
    }
  )
})

test('listPointsOfInterest resolves with an empty array for an empty result', async () => {
  await withMockFetch(
    () => jsonResponse({ pointsOfInterest: [] }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
    }
  )
})

test('listPointsOfInterest drops cluster entries with poiCount above 1', async () => {
  await withMockFetch(
    () => jsonResponse({
      pointsOfInterest: [
        { id: '1', poiType: 'Marina', mapLocation: { latitude: 12, longitude: -70 }, name: 'Real marina' },
        { id: '99', poiType: 'Marina', mapLocation: { latitude: 12.1, longitude: -70.1 }, poiCount: 4 }
      ]
    }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      // The cluster entry (poiCount 4, no name) is dropped: getResource on its
      // synthetic id would 404.
      assert.deepEqual(result.map(poi => poi.id), ['1'])
    }
  )
})

test('listPointsOfInterest skips malformed elements instead of failing the whole list', async () => {
  await withMockFetch(
    () => jsonResponse({
      pointsOfInterest: [
        { id: '1', poiType: 'Marina', mapLocation: { latitude: 12.5, longitude: -70.1 }, name: 'Good' },
        { id: '2', poiType: 'Marina', name: 'No location' },
        { id: '3', poiType: 'Marina', mapLocation: { latitude: 'x', longitude: -70.2 }, name: 'Bad coords' },
        null
      ]
    }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [
        { id: '1', type: 'Marina', position: { latitude: 12.5, longitude: -70.1 }, name: 'Good' }
      ])
    }
  )
})

test('listPointsOfInterest rejects on a non-ok HTTP status', async () => {
  await withMockFetch(
    () => jsonResponse({ message: 'not found' }, 404),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      await assert.rejects(
        () => client.listPointsOfInterest(sampleBbox, 'Marina'),
        /list request failed: 404/
      )
    }
  )
})

test('listPointsOfInterest rejects on a malformed response body', async () => {
  await withMockFetch(
    () => jsonResponse({ unexpected: true }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      await assert.rejects(
        () => client.listPointsOfInterest(sampleBbox, 'Marina'),
        /missing pointsOfInterest/
      )
    }
  )
})

test('pointOfInterestDetails returns the parsed detail body', async () => {
  const details = {
    pointOfInterest: {
      id: 7,
      name: 'Detail Marina',
      poiType: 'Marina',
      mapLocation: { latitude: 1, longitude: 2 },
      dateLastModified: '2024-01-01T00:00:00Z'
    }
  }
  await withMockFetch(
    () => jsonResponse(details),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.pointOfInterestDetails('7')
      assert.deepEqual(result, details)
    }
  )
})

test('pointOfInterestDetails rejects on a non-ok HTTP status', async () => {
  await withMockFetch(
    () => jsonResponse({ message: 'gone' }, 410),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      await assert.rejects(
        () => client.pointOfInterestDetails('7'),
        /details request failed for 7: 410/
      )
    }
  )
})

test('a 429 response is retried and then succeeds', async () => {
  await withMockFetch(
    callIndex => callIndex === 0
      ? jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '0' })
      : jsonResponse({ pointsOfInterest: [] }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2, 'expected one retry after the 429')
    }
  )
})

test('a persistent 503 response rejects after retries are exhausted', async () => {
  await withMockFetch(
    () => jsonResponse({ message: 'boom' }, 503),
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      await assert.rejects(
        () => client.pointOfInterestDetails('7'),
        /details request failed for 7: 503/
      )
      assert.equal(calls.count, 3, 'expected the initial try plus two retries')
    }
  )
})

test('a non-retryable 4xx response rejects immediately without retrying', async () => {
  await withMockFetch(
    () => jsonResponse({ message: 'gone' }, 404),
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      await assert.rejects(
        () => client.pointOfInterestDetails('7'),
        /details request failed for 7: 404/
      )
      assert.equal(calls.count, 1, 'expected no retry for a permanent 404')
    }
  )
})

test('a network error is retried and then succeeds', async () => {
  await withMockFetch(
    callIndex => {
      if (callIndex === 0) {
        throw new Error('network down')
      }
      return jsonResponse({ pointsOfInterest: [] })
    },
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2, 'expected one retry after the network error')
    }
  )
})
