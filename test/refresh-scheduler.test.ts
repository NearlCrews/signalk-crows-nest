import test from 'node:test'
import assert from 'node:assert/strict'
import { startRefreshScheduler } from '../src/inputs/refresh-scheduler.js'
import { flush } from './helpers.js'

test('close aborts the active refresh and closes the wrapped source', async () => {
  let capturedSignal: AbortSignal | undefined
  let closed = false
  const source = {
    refreshAll: async (signal?: AbortSignal): Promise<void> => {
      capturedSignal = signal
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
    },
    close: () => { closed = true }
  }
  const scheduled = startRefreshScheduler({
    source,
    app: { debug: () => {} } as never,
    name: 'Test source',
    intervalMs: 60_000,
    initialDelayMs: 0
  })

  await flush()
  assert.equal(capturedSignal?.aborted, false)
  scheduled.close()
  assert.equal(capturedSignal?.aborted, true)
  assert.equal(closed, true)
  await flush()
})
