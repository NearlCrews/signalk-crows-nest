import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpClient } from '../src/inputs/http-client.js'
import { silentLog } from './helpers.js'

const defaults = {
  maxConcurrency: 1,
  minDelayMs: 0,
  backoffBaseMs: 1,
  maxBackoffMs: 1,
  maxRetries: 0,
  maxRetryAfterMs: 1
}

async function withMockFetch (
  response: () => Response,
  run: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async () => response()) as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

test('queued HTTP client rejects an oversized advertised body', async () => {
  await withMockFetch(
    () => new Response('oversized', { headers: { 'content-length': '9' } }),
    async () => {
      const client = createHttpClient(silentLog, {
        label: 'Test',
        requestTimeoutMs: 1000,
        maxResponseBytes: 8,
        defaults
      })
      await assert.rejects(client.fetch('https://example.test/data', {}), /response exceeds 8 bytes/)
      client.close()
    }
  )
})

test('queued HTTP client cancels a streaming body after it crosses the cap', async () => {
  let cancelled = false
  const encoder = new TextEncoder()
  await withMockFetch(
    () => new Response(new ReadableStream<Uint8Array>({
      start (controller) {
        controller.enqueue(encoder.encode('1234'))
        controller.enqueue(encoder.encode('5678'))
      },
      cancel () {
        cancelled = true
      }
    })),
    async () => {
      const client = createHttpClient(silentLog, {
        label: 'Test',
        requestTimeoutMs: 1000,
        maxResponseBytes: 6,
        defaults
      })
      const response = await client.fetch('https://example.test/data', {})
      await assert.rejects(response.text(), /response exceeds 6 bytes/)
      assert.equal(cancelled, true)
      client.close()
    }
  )
})
