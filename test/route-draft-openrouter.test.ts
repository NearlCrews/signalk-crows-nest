import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OpenRouterClient,
  OpenRouterError,
  type CompleteArgs,
  type OpenRouterConfig
} from '../src/route-draft/openrouter.js'
import { jsonResponse, silentLog, withMockFetch } from './helpers.js'
import { PLUGIN_ID, PLUGIN_REPO_URL } from '../src/shared/plugin-id.js'

/**
 * A base client config. `random` is pinned so the (unexercised here) backoff
 * jitter is deterministic, and the timeout is generous since the stub resolves
 * synchronously.
 */
const baseConfig: OpenRouterConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://openrouter.test/api/v1',
  model: 'google/gemini-2.5-flash',
  requestTimeoutMs: 1000,
  referer: PLUGIN_REPO_URL,
  title: PLUGIN_ID,
  random: () => 0
}

/** A minimal well-formed success body with the given content and finish reason. */
function completion (content: string, finishReason: string | null = 'stop', extra: object = {}): object {
  return {
    model: baseConfig.model,
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...extra
  }
}

/** Parse the recorded request body into a plain object. */
function bodyOf (calls: { lastInit?: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(calls.lastInit?.body)) as Record<string, unknown>
}

test('a free-text completion sends the single model and the default max_tokens', async () => {
  await withMockFetch(
    () => jsonResponse(completion('hello')),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      const result = await client.complete({ system: 'sys', user: 'usr' })
      const body = bodyOf(calls)
      assert.equal(body.model, baseConfig.model, 'the single model is sent')
      assert.equal(body.models, undefined, 'no fallback array when models is absent')
      assert.equal(body.max_tokens, 2000, 'the module default ceiling')
      assert.equal(body.response_format, undefined)
      assert.equal(body.provider, undefined)
      assert.equal(result.text, 'hello')
    }
  )
})

test('the attribution header is X-Title, not X-OpenRouter-Title', async () => {
  await withMockFetch(
    () => jsonResponse(completion('hello')),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await client.complete({ system: 'sys', user: 'usr' })
      const headers = calls.lastInit?.headers as Record<string, string>
      assert.equal(headers['X-Title'], 'signalk-crows-nest')
      assert.equal(headers['HTTP-Referer'], baseConfig.referer)
      assert.equal(headers['X-OpenRouter-Title'], undefined, 'the ignored companion header is gone')
    }
  )
})

test('the structured-output request shape: response_format, models, provider, per-call max', async () => {
  await withMockFetch(
    () => jsonResponse(completion('{"waypoints":[]}')),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      const args: CompleteArgs = {
        system: 'sys',
        user: 'usr',
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: 'route', strict: true, schema: { type: 'object' } }
        },
        models: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
        provider: { require_parameters: true },
        maxTokens: 4096
      }
      await client.complete(args)
      const body = bodyOf(calls)
      assert.deepEqual(
        body.models,
        ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
        'the fallback array is sent'
      )
      assert.equal(body.model, undefined, 'the single model is omitted when a models array is present')
      assert.deepEqual(body.response_format, args.responseFormat, 'response_format is passed through')
      assert.deepEqual(body.provider, { require_parameters: true }, 'provider require_parameters is sent')
      assert.equal(body.max_tokens, 4096, 'the per-call max_tokens overrides the default')
    }
  )
})

test('an empty models array falls back to the single model', async () => {
  await withMockFetch(
    () => jsonResponse(completion('hello')),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await client.complete({ system: 'sys', user: 'usr', models: [] })
      const body = bodyOf(calls)
      assert.equal(body.model, baseConfig.model)
      assert.equal(body.models, undefined)
    }
  )
})

test('finish_reason of length is a terminal model error, not a usable draft', async () => {
  await withMockFetch(
    () => jsonResponse(completion('{"waypoints":[', 'length')),
    async () => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr' }),
        (err: unknown) => {
          assert.ok(err instanceof OpenRouterError)
          assert.equal(err.kind, 'finish-length')
          assert.equal(err.status, 200)
          return true
        }
      )
    }
  )
})

test('finish_reason of content_filter is a terminal model error', async () => {
  await withMockFetch(
    () => jsonResponse(completion('blocked', 'content_filter')),
    async () => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr' }),
        (err: unknown) => {
          assert.ok(err instanceof OpenRouterError)
          assert.equal(err.kind, 'finish-content-filter')
          return true
        }
      )
    }
  )
})

test('finish_reason of error is a terminal model error with kind finish-error', async () => {
  await withMockFetch(
    () => jsonResponse(completion('', 'error')),
    async () => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr' }),
        (err: unknown) => {
          assert.ok(err instanceof OpenRouterError)
          assert.equal(err.kind, 'finish-error')
          assert.equal(err.status, 200)
          return true
        }
      )
    }
  )
})

test('a status-200 empty completion is a terminal model error', async () => {
  await withMockFetch(
    () => jsonResponse(completion('   ', 'stop')),
    async () => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr' }),
        (err: unknown) => {
          assert.ok(err instanceof OpenRouterError)
          assert.equal(err.kind, 'empty-completion')
          assert.equal(err.status, 200)
          return true
        }
      )
    }
  )
})

test('usage cost and cached_tokens are parsed alongside the token counts', async () => {
  await withMockFetch(
    () => jsonResponse(completion('hello', 'stop', {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        cost: 0.0021,
        prompt_tokens_details: { cached_tokens: 64 }
      }
    })),
    async () => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      const result = await client.complete({ system: 'sys', user: 'usr' })
      assert.deepEqual(result.usage, {
        promptTokens: 100,
        completionTokens: 40,
        totalTokens: 140,
        cost: 0.0021,
        cachedTokens: 64
      })
    }
  )
})

test('a missing usage block yields zeroed cost and cached_tokens', async () => {
  await withMockFetch(
    () => jsonResponse({ model: baseConfig.model, choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }),
    async () => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      const result = await client.complete({ system: 'sys', user: 'usr' })
      assert.equal(result.usage.cost, 0)
      assert.equal(result.usage.cachedTokens, 0)
      assert.equal(result.usage.totalTokens, 0)
    }
  )
})

test('a terminal non-200 status throws an http OpenRouterError carrying the status', async () => {
  await withMockFetch(
    () => jsonResponse({ error: { message: 'insufficient credits' } }, 402),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr' }),
        (err: unknown) => {
          assert.ok(err instanceof OpenRouterError)
          assert.equal(err.kind, 'http')
          assert.equal(err.status, 402)
          assert.match(err.message, /insufficient credits/)
          return true
        }
      )
      assert.equal(calls.count, 1, 'a terminal status is not retried')
    }
  )
})

test('a transient 503 is retried honoring Retry-After, then succeeds', async () => {
  await withMockFetch(
    (callIndex) => callIndex === 0
      ? jsonResponse({ error: { message: 'no provider meets routing requirements' } }, 503, { 'Retry-After': '0' })
      : jsonResponse(completion('hello')),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      const result = await client.complete({ system: 'sys', user: 'usr' })
      assert.equal(result.text, 'hello')
      assert.equal(calls.count, 2, 'one retry after the 503')
    }
  )
})

test('a transient status that never clears throws after the retry budget exhausts', async () => {
  await withMockFetch(
    () => jsonResponse({ error: { message: 'rate limited' } }, 429, { 'Retry-After': '0' }),
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr' }),
        (err: unknown) => {
          assert.ok(err instanceof OpenRouterError)
          assert.equal(err.status, 429)
          return true
        }
      )
      // The first attempt plus MAX_RETRIES (3) retries.
      assert.equal(calls.count, 4)
    }
  )
})

test('a caller abort mid-request propagates untouched rather than retrying', async () => {
  const controller = new AbortController()
  await withMockFetch(
    () => {
      controller.abort(new Error('caller aborted'))
      throw new DOMException('The operation was aborted', 'AbortError')
    },
    async (calls) => {
      const client = new OpenRouterClient(baseConfig, silentLog)
      await assert.rejects(
        () => client.complete({ system: 'sys', user: 'usr', abortSignal: controller.signal }),
        /aborted/
      )
      assert.equal(calls.count, 1, 'a caller abort is not retried')
    }
  )
})
