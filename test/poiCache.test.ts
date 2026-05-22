/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createPoiCache, type PoiDetailsSource } from '../src/poiCache.js'
import type { PoiDetails } from '../src/types.js'

/** Generous cache lifetime so entries never expire mid-test. */
const TTL_MINUTES = 60

/** Build a minimal but valid PoiDetails record for the given id. */
function makeDetails (id: string): PoiDetails {
  return {
    pointOfInterest: {
      id: Number(id),
      name: `POI ${id}`,
      poiType: 'Marina',
      mapLocation: { latitude: 0, longitude: 0 },
      dateLastModified: '2024-01-01T00:00:00Z'
    }
  }
}

/** A PoiDetailsSource that counts calls and can be told to fail the next loads. */
interface FakeSource extends PoiDetailsSource {
  callCount: () => number
}

function createFakeSource (failTimes = 0): FakeSource {
  let calls = 0
  let remainingFailures = failTimes
  return {
    pointOfInterestDetails: async (id: string): Promise<PoiDetails> => {
      calls++
      if (remainingFailures > 0) {
        remainingFailures--
        throw new Error('load failed')
      }
      return makeDetails(id)
    },
    callCount: () => calls
  }
}

test('get loads on a miss and calls the source once', async () => {
  const source = createFakeSource()
  const cache = createPoiCache(source, TTL_MINUTES)

  const details = await cache.get('1')

  assert.equal(details.pointOfInterest.name, 'POI 1')
  assert.equal(source.callCount(), 1)
})

test('a second get is served from cache without a second source call', async () => {
  const source = createFakeSource()
  const cache = createPoiCache(source, TTL_MINUTES)

  const first = await cache.get('1')
  const second = await cache.get('1')

  assert.deepEqual(second, first)
  assert.equal(source.callCount(), 1, 'expected the cached entry to be reused')
})

test('a rejected load rejects and is not cached, so the next get retries', async () => {
  const source = createFakeSource(1)
  const cache = createPoiCache(source, TTL_MINUTES)

  await assert.rejects(() => cache.get('1'), /load failed/)
  assert.equal(source.callCount(), 1)

  // The failed load was not cached: the next get hits the source again.
  const details = await cache.get('1')
  assert.equal(details.pointOfInterest.name, 'POI 1')
  assert.equal(source.callCount(), 2)
})

test('clear empties the cache so the next get reloads', async () => {
  const source = createFakeSource()
  const cache = createPoiCache(source, TTL_MINUTES)

  await cache.get('1')
  assert.equal(source.callCount(), 1)

  cache.clear()

  await cache.get('1')
  assert.equal(source.callCount(), 2, 'expected clear to force a reload')
})

test('the load listener fires only on a real load, not on a cache hit', async () => {
  const source = createFakeSource()
  let successes = 0
  let errors = 0
  const cache = createPoiCache(source, TTL_MINUTES, {
    onLoadSuccess: () => { successes++ },
    onLoadError: () => { errors++ }
  })

  await cache.get('1')
  await cache.get('1') // served from cache: must not notify again

  assert.equal(successes, 1, 'expected one load notification for the miss only')
  assert.equal(errors, 0)
})

test('the load listener reports a failed load', async () => {
  const source = createFakeSource(1)
  let successes = 0
  let errors = 0
  const cache = createPoiCache(source, TTL_MINUTES, {
    onLoadSuccess: () => { successes++ },
    onLoadError: () => { errors++ }
  })

  await assert.rejects(() => cache.get('1'), /load failed/)
  assert.equal(errors, 1)
  assert.equal(successes, 0)
})
