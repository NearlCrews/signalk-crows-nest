import test from 'node:test'
import assert from 'node:assert/strict'
import { mapWithConcurrency } from '../src/shared/concurrency.js'

test('mapWithConcurrency preserves result order while bounding active work', async () => {
  let active = 0
  let maximum = 0
  const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise<void>((resolve) => setImmediate(resolve))
    active -= 1
    return value * 2
  })

  assert.deepEqual(result, [2, 4, 6, 8])
  assert.equal(maximum, 2)
})

test('mapWithConcurrency rejects invalid limits', async () => {
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      mapWithConcurrency([1], limit, async (value) => value),
      /limit must be a positive integer/
    )
  }
})

test('mapWithConcurrency validates the limit for an empty work list', async () => {
  await assert.rejects(
    mapWithConcurrency([], Number.NaN, async (value) => value),
    /limit must be a positive integer/
  )
  assert.deepEqual(await mapWithConcurrency([], 1, async (value) => value), [])
})
