import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveCaptainClient, type RateLimitOptions, type Sleep } from '../src/inputs/active-captain/active-captain-client.js'
import type { Bbox } from '../src/shared/types.js'
import { jsonResponse, silentLog } from './helpers.js'

/** Fast rate-limit settings so the retry tests do not sleep for whole seconds. */
const fastLimits: Partial<RateLimitOptions> = {
  minDelayMs: 0,
  backoffBaseMs: 1,
  maxBackoffMs: 4,
  maxRetries: 2
}

const sampleBbox: Bbox = { north: 1, south: 0, east: 1, west: 0 }

/** Sleep for the given number of milliseconds. */
const delayMs = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * Swap in a stubbed global fetch for the duration of fn, then restore it. The
 * stub records every call so tests can assert on retry behavior.
 */
async function withMockFetch (
  handler: (callIndex: number, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: { count: number }) => Promise<void>
): Promise<void> {
  const original = globalThis.fetch
  const calls = { count: 0 }
  globalThis.fetch = (async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const callIndex = calls.count
    calls.count++
    return handler(callIndex, init)
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

test('listPointsOfInterest treats a zero-review reviewSummary as unrated, not as a 0/5 rating', async () => {
  // The AC API sometimes returns `reviewSummary: { averageRating: 0,
  // numberOfReviews: 0 }` for a marina that has not been reviewed
  // yet. That zero is a placeholder, not a real rating: the summary
  // must NOT carry `rating: 0`, otherwise the minimum-rating filter
  // would either incorrectly include it (when minimumRating is 0) or
  // drop it under exactly the same code path that hides a genuine
  // 0-star marina, and the popup would render a meaningless "0/5 ⭐
  // from (0 reviews)" line.
  await withMockFetch(
    () => jsonResponse({
      pointsOfInterest: [
        {
          id: '99',
          poiType: 'Marina',
          mapLocation: { latitude: 1, longitude: 2 },
          name: 'Brand new marina, no reviews yet',
          reviewSummary: { averageRating: 0, numberOfReviews: 0 }
        }
      ]
    }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.equal(result.length, 1)
      assert.equal(result[0].rating, undefined, 'rating is undefined when there are no reviews')
      assert.equal(result[0].reviewCount, undefined, 'reviewCount is undefined when there are no reviews')
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

test('a 502 response is retried and then succeeds', async () => {
  await withMockFetch(
    callIndex => callIndex === 0
      ? jsonResponse({ message: 'bad gateway' }, 502)
      : jsonResponse({ pointsOfInterest: [] }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2, 'expected one retry after the 502')
    }
  )
})

test('a 504 response is retried and then succeeds', async () => {
  await withMockFetch(
    callIndex => callIndex === 0
      ? jsonResponse({ message: 'gateway timeout' }, 504)
      : jsonResponse({ pointsOfInterest: [] }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2, 'expected one retry after the 504')
    }
  )
})

test('pointOfInterestDetails rejects a detail body missing required fields', async () => {
  await withMockFetch(
    // The point-of-interest block is present but carries no poiType, name, or
    // mapLocation: the fields getResource later dereferences without a guard.
    () => jsonResponse({ pointOfInterest: { id: 7 } }),
    async () => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      await assert.rejects(
        () => client.pointOfInterestDetails('7'),
        /missing required point-of-interest fields/
      )
    }
  )
})

test('close() rejects a new request without touching the network', async () => {
  await withMockFetch(
    (_callIndex, init) => {
      if (init?.signal?.aborted === true) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }
      return jsonResponse({ pointsOfInterest: [] })
    },
    async calls => {
      const client = createActiveCaptainClient(silentLog, fastLimits)
      client.close()
      // The closed queue rejects at enqueue, before any fetch or retry runs.
      await assert.rejects(() => client.listPointsOfInterest(sampleBbox, 'Marina'), /client closed/)
      assert.equal(calls.count, 0, 'expected no fetch once the client is closed')
    }
  )
})

test('the request queue spaces request starts by minDelayMs', async () => {
  const starts: number[] = []
  await withMockFetch(
    () => {
      starts.push(Date.now())
      return jsonResponse({ pointsOfInterest: [] })
    },
    async () => {
      const client = createActiveCaptainClient(silentLog, {
        ...fastLimits, maxConcurrency: 1, minDelayMs: 40
      })
      await Promise.all([
        client.listPointsOfInterest(sampleBbox, 'Marina'),
        client.listPointsOfInterest(sampleBbox, 'Marina'),
        client.listPointsOfInterest(sampleBbox, 'Marina')
      ])
      assert.equal(starts.length, 3)
      // Three serialized requests at minDelayMs: 40 should span at least one
      // full delay of cumulative spacing. Asserting the cumulative span rather
      // than each gap tolerates the coarse Date.now() and timer resolution on
      // Windows, where a single 40 ms gap can measure as little as ~24 ms while
      // the two gaps together still clear one delay. Without throttling all
      // three would start within a couple of milliseconds.
      const cumulativeSpacing = starts[starts.length - 1] - starts[0]
      assert.ok(
        cumulativeSpacing >= 40,
        `expected the throttle to space the starts, got ${cumulativeSpacing}ms cumulative`
      )
    }
  )
})

test('the request queue caps in-flight requests at maxConcurrency', async () => {
  let active = 0
  let peak = 0
  await withMockFetch(
    async () => {
      active++
      peak = Math.max(peak, active)
      await delayMs(15)
      active--
      return jsonResponse({ pointsOfInterest: [] })
    },
    async () => {
      const client = createActiveCaptainClient(silentLog, {
        ...fastLimits, maxConcurrency: 2, minDelayMs: 0
      })
      await Promise.all([
        client.listPointsOfInterest(sampleBbox, 'Marina'),
        client.listPointsOfInterest(sampleBbox, 'Marina'),
        client.listPointsOfInterest(sampleBbox, 'Marina'),
        client.listPointsOfInterest(sampleBbox, 'Marina'),
        client.listPointsOfInterest(sampleBbox, 'Marina')
      ])
      assert.equal(peak, 2, 'expected at most two requests in flight at once')
    }
  )
})

/**
 * Build a recording sleep injection. Each call resolves immediately and
 * pushes the requested ms into `waits`, so a test can assert the wait the
 * client asked for without paying it on the wall clock.
 */
function recordingSleep (): { sleep: Sleep, waits: number[] } {
  const waits: number[] = []
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms)
    }
  }
}

test('a 429 Retry-After header in seconds is honored before the retry', async () => {
  const { sleep, waits } = recordingSleep()
  await withMockFetch(
    callIndex => callIndex === 0
      ? jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '1' })
      : jsonResponse({ pointsOfInterest: [] }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, {
        minDelayMs: 0, backoffBaseMs: 1, maxBackoffMs: 5000, maxRetries: 2
      }, sleep)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2)
    }
  )
  // The recorded wait is the value the client asked the sleeper for, not the
  // observed wall-clock elapsed time. A 1 s Retry-After must produce a
  // ~1000 ms wait; backoff alone with backoffBaseMs 1 would be sub-ms.
  assert.equal(waits.length, 1, 'one sleep call between the two requests')
  assert.equal(waits[0], 1000, 'expected the retry to wait exactly 1 s for Retry-After')
})

test('a 429 Retry-After header as an HTTP date is honored before the retry', async () => {
  const { sleep, waits } = recordingSleep()
  // An HTTP date carries whole-second precision; two seconds ahead leaves
  // a wait of about 1.x s once the sub-second part is truncated by the
  // parser. The exact value depends on event-loop timing, so the assertion
  // brackets it loosely (between half a second and just over two seconds).
  const retryAt = new Date(Date.now() + 2000).toUTCString()
  await withMockFetch(
    callIndex => callIndex === 0
      ? jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': retryAt })
      : jsonResponse({ pointsOfInterest: [] }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, {
        minDelayMs: 0, backoffBaseMs: 1, maxBackoffMs: 5000, maxRetries: 2
      }, sleep)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2)
    }
  )
  assert.equal(waits.length, 1)
  assert.ok(waits[0] >= 500 && waits[0] <= 2100,
    `expected ~1-2 s HTTP-date Retry-After wait, got ${waits[0]} ms`)
})

test('a huge Retry-After value is capped at maxRetryAfterMs', async () => {
  const { sleep, waits } = recordingSleep()
  await withMockFetch(
    callIndex => callIndex === 0
      ? jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '99999' })
      : jsonResponse({ pointsOfInterest: [] }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, {
        minDelayMs: 0,
        backoffBaseMs: 1,
        maxBackoffMs: 30,
        maxRetryAfterMs: 50,
        maxRetries: 2
      }, sleep)
      const result = await client.listPointsOfInterest(sampleBbox, 'Marina')
      assert.deepEqual(result, [])
      assert.equal(calls.count, 2)
    }
  )
  // 99999 seconds would stall for over a day if honored literally; the cap
  // pulls the wait down to maxRetryAfterMs (50 ms here). The cap is
  // decoupled from maxBackoffMs so a real Overpass-style cooldown
  // (60-120 s) is not truncated into another instant 429.
  assert.equal(waits.length, 1)
  assert.equal(waits[0], 50, 'expected the huge Retry-After to be capped at maxRetryAfterMs')
})

test('close aborts a pending Retry-After wait immediately', async () => {
  let markSleeping: (() => void) | undefined
  const sleeping = new Promise<void>((resolve) => { markSleeping = resolve })
  const neverSettles: Sleep = async () => {
    markSleeping?.()
    await new Promise<void>(() => {})
  }
  await withMockFetch(
    () => jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '300' }),
    async calls => {
      const client = createActiveCaptainClient(silentLog, {
        minDelayMs: 0,
        backoffBaseMs: 1,
        maxBackoffMs: 10,
        maxRetryAfterMs: 300_000,
        maxRetries: 2
      }, neverSettles)
      const request = client.listPointsOfInterest(sampleBbox, 'Marina')
      await sleeping
      client.close()
      await assert.rejects(request)
      assert.equal(calls.count, 1, 'close prevents the retry request')
    }
  )
})
