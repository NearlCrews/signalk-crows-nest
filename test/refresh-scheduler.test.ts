import test from 'node:test'
import assert from 'node:assert/strict'
import { startRefreshScheduler } from '../src/inputs/refresh-scheduler.js'
import { flush } from './helpers.js'

test('close aborts the active refresh and closes the wrapped source', async () => {
  let capturedSignal: AbortSignal | undefined
  let markRefreshStarted: () => void = () => {}
  const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve })
  let closed = false
  const source = {
    refreshAll: async (signal?: AbortSignal): Promise<void> => {
      capturedSignal = signal
      markRefreshStarted()
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

  let scheduledClosed = false
  try {
    await refreshStarted
    assert.equal(capturedSignal?.aborted, false)
    scheduled.close()
    scheduledClosed = true
    assert.equal(capturedSignal?.aborted, true)
    assert.equal(closed, true)
    await flush()
  } finally {
    if (!scheduledClosed) scheduled.close()
  }
})
