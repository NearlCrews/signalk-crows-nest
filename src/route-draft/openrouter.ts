/**
 * OpenRouter chat-completions client for the route-draft module.
 *
 * Lifted from signalk-openrouter-companion and restyled to crows-nest
 * conventions (neostandard, no semicolons, node16 `.js` import specifiers,
 * string logging through an injected logger). It is built on `fetch` plus
 * `AbortSignal.timeout` and `AbortSignal.any`, mirroring `src/inputs/
 * http-client.ts`, because the GET-only one-shot helper cannot POST.
 *
 * The client extends the companion's hardcoded body in two directions. On the
 * request side it threads optional structured-output settings (`responseFormat`
 * as `response_format`, a fallback `models` array sent instead of `model`, a
 * `provider` block for `{ require_parameters: true }`, and a per-call
 * `maxTokens`) into the JSON body only when present, keeping the original
 * single-`model`, constant-`max_tokens` path intact. On the response side it
 * reads `choices[0].finish_reason` and the full `usage` block (`cost` and
 * `prompt_tokens_details.cached_tokens` alongside the token counts).
 *
 * A truncated (`finish_reason: 'length'`), filtered (`content_filter`), or
 * empty status-200 completion is NOT a usable draft. Each throws an
 * `OpenRouterError` whose `kind` distinguishes the condition, so the
 * route-draft endpoint maps all three to its `model-error` contract code.
 *
 * The attribution header is `X-Title` (the documented OpenRouter header,
 * sent with `HTTP-Referer`); the companion's `X-OpenRouter-Title` was ignored.
 */

import type { Logger } from '../shared/types.js'
import { parseRetryAfterMs } from '../shared/retry-after.js'
import { combineAbortSignals } from '../shared/abort.js'

/** Static configuration for an {@link OpenRouterClient}. */
export interface OpenRouterConfig {
  /** OpenRouter API key, sent as the bearer token. */
  apiKey: string
  /** API base URL, e.g. `https://openrouter.ai/api/v1` (no trailing slash). */
  baseUrl: string
  /** Default model slug, used when a call does not pass a `models` array. */
  model: string
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number
  /** Sent as `HTTP-Referer` for OpenRouter attribution. */
  referer: string
  /** Sent as `X-Title` for OpenRouter attribution. */
  title: string
  /** Injectable randomness for backoff jitter; defaults to `Math.random`. */
  random?: () => number
}

/** A provider-routing block, passed through to OpenRouter as `provider`. */
export interface ProviderRouting {
  /**
   * When true, OpenRouter filters the provider pool to those that honor every
   * request parameter (notably `response_format`), so an incapable provider
   * errors rather than returning prose. Other provider-routing keys are
   * accepted and passed through untouched.
   */
  require_parameters?: boolean
  [key: string]: unknown
}

/** A `response_format` block, passed through to OpenRouter unchanged. */
export interface ResponseFormat {
  type: string
  json_schema?: {
    name: string
    strict?: boolean
    schema: unknown
  }
  [key: string]: unknown
}

/** Arguments for one `complete` call. */
export interface CompleteArgs {
  /** System-role message (the stable prompt prefix). */
  system: string
  /** User-role message (the variable request content). */
  user: string
  /** Caller abort signal; trips both the request and any backoff wait. */
  abortSignal?: AbortSignal
  /**
   * Structured-output request, threaded into the body as `response_format`
   * only when present. Absent leaves the call as a free-text completion.
   */
  responseFormat?: ResponseFormat
  /**
   * Fallback model list. When present it is sent as `models` INSTEAD of
   * `model`, so OpenRouter tries each in order; absent falls back to the
   * single configured `model`.
   */
  models?: string[]
  /**
   * Provider-routing block, sent as `provider` only when present (for
   * `{ require_parameters: true }`).
   */
  provider?: ProviderRouting
  /**
   * Per-call output-token ceiling. Overrides the module default only when
   * present, so existing callers keep the constant ceiling.
   */
  maxTokens?: number
  /**
   * Sampling temperature, threaded into the body only when present. The
   * route-draft path sets a low value for repeatable coordinates; an absent
   * value leaves the provider default.
   */
  temperature?: number
}

/** Token, cost, and cache accounting parsed from the response `usage` block. */
export interface CompleteUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Dollar cost of the call when OpenRouter reports it, else 0. */
  cost: number
  /** Prompt tokens served from the provider's cache when reported, else 0. */
  cachedTokens: number
}

/** A usable completion. */
export interface CompleteResult {
  text: string
  model: string
  usage: CompleteUsage
}

/**
 * The category of an {@link OpenRouterError}, so the route-draft endpoint can
 * map a terminal condition onto its contract error code without re-parsing the
 * HTTP status or the message string.
 *
 * - `http`: a terminal non-200 HTTP status (the status is on `.status`).
 * - `empty-completion`: a status-200 response whose completion text was blank.
 * - `finish-length`: `choices[0].finish_reason === 'length'` (truncated).
 * - `finish-content-filter`: `choices[0].finish_reason === 'content_filter'`.
 * - `finish-error`: `choices[0].finish_reason === 'error'`, a provider-side
 *   failure surfaced on an otherwise status-200 completion.
 * - `transport`: a transport or body-read fault, after retries exhausted.
 */
export type OpenRouterErrorKind =
  | 'http'
  | 'empty-completion'
  | 'finish-length'
  | 'finish-content-filter'
  | 'finish-error'
  | 'transport'

/**
 * A terminal OpenRouter failure. `kind` distinguishes the condition; `status`
 * is the HTTP status (200 for the finish-reason and empty-completion cases, 0
 * for a transport fault). The endpoint maps every kind here, plus a 402, to its
 * `model-error` code, except the auth and permission statuses it reads off
 * `.status` for `unauthorized`.
 */
export class OpenRouterError extends Error {
  constructor (
    readonly status: number,
    readonly kind: OpenRouterErrorKind,
    message: string,
    readonly metadata?: unknown
  ) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

interface ApiResponse {
  choices?: Array<{ message?: { content?: string }, finish_reason?: string | null }>
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cost?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

interface ApiErrorBody {
  error?: { code?: number, message?: string, metadata?: unknown }
}

/**
 * Statuses worth a retry: rate limiting and gateway or server faults,
 * including the 503 OpenRouter returns when no provider meets the routing
 * requirements. Every other non-200 status is terminal and throws at once.
 */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

/** HTTP status the client honors a `Retry-After` header for. */
const RATE_LIMITED_STATUSES = new Set([429, 503])

const MAX_RETRIES = 3

/**
 * Default output-token ceiling for a single completion when a call does not
 * pass `maxTokens`. A per-call override (sized against the worst-case
 * schema-conformant draft) is the route-draft path; this constant keeps the
 * companion's original single-call bound for any caller that omits it. The
 * per-day call cap in BudgetTracker bounds total spend; this bounds one call.
 */
const DEFAULT_MAX_COMPLETION_TOKENS = 2000

/** Backoff ladder, in milliseconds, indexed by zero-based attempt. */
const BACKOFF_LADDER = [500, 1500, 4500] as const

/**
 * One attempt's terminal outcome: a usable result, or a retry signal carrying
 * the error to throw once the retry budget is exhausted.
 */
type Attempt =
  | { kind: 'result', result: CompleteResult }
  | { kind: 'retry', error: OpenRouterError, retryAfterMs: number | null }

export class OpenRouterClient {
  private readonly random: () => number

  constructor (private readonly cfg: OpenRouterConfig, private readonly log?: Logger) {
    this.random = cfg.random ?? Math.random
  }

  async complete (args: CompleteArgs): Promise<CompleteResult> {
    for (let attemptNumber = 0; ; attemptNumber += 1) {
      const outcome = await this.attempt(args)
      if (outcome.kind === 'result') return outcome.result
      if (attemptNumber >= MAX_RETRIES) throw outcome.error
      const waitMs = backoffMs(attemptNumber, outcome.retryAfterMs, this.random)
      this.log?.debug(
        `OpenRouter request returned ${outcome.error.status}, retrying in ${Math.round(waitMs)}ms ` +
        `(attempt ${attemptNumber + 1}/${MAX_RETRIES})`
      )
      // delay() rejects with the caller's abort reason if the signal trips
      // mid-backoff, so a shutdown does not wait out the full delay first.
      await delay(waitMs, args.abortSignal)
    }
  }

  /**
   * A single request bounded by its own timeout, combined with the caller's
   * abort signal. Throws for terminal failures (a terminal HTTP status, a
   * length or content-filter finish reason, an empty completion, a caller
   * abort); returns a retry signal for transient HTTP statuses and transport
   * faults, including the request timeout.
   */
  private async attempt (args: CompleteArgs): Promise<Attempt> {
    let res: Response
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.cfg.referer,
          'X-Title': this.cfg.title
        },
        body: JSON.stringify(this.buildBody(args)),
        signal: combineAbortSignals([AbortSignal.timeout(this.cfg.requestTimeoutMs), args.abortSignal])
      })
    } catch (err) {
      return transportRetry(args, err)
    }

    if (res.status === 200) {
      let body: ApiResponse
      try {
        body = await res.json() as ApiResponse
      } catch (err) {
        // The timeout firing mid-body-read, or a truncated or malformed
        // payload: same transient treatment as a failed fetch.
        return transportRetry(args, err)
      }
      return this.readSuccess(body)
    }

    const errBody = await safeJson(res)
    const message = errBody?.error?.message ?? `HTTP ${res.status}`
    const metadata = errBody?.error?.metadata
    if (TRANSIENT_STATUSES.has(res.status)) {
      return {
        kind: 'retry',
        error: new OpenRouterError(res.status, 'http', message, metadata),
        retryAfterMs: RATE_LIMITED_STATUSES.has(res.status)
          ? parseRetryAfterMs(res.headers.get('retry-after')) ?? null
          : null
      }
    }
    throw new OpenRouterError(res.status, 'http', message, metadata)
  }

  /** Assemble the request body, threading the optional fields in only when present. */
  private buildBody (args: CompleteArgs): Record<string, unknown> {
    const body: Record<string, unknown> = {
      max_tokens: args.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user }
      ]
    }
    // A fallback array replaces the single model so OpenRouter tries each in
    // order; otherwise the configured single model is sent.
    if (args.models !== undefined && args.models.length > 0) {
      body.models = args.models
    } else {
      body.model = this.cfg.model
    }
    if (args.responseFormat !== undefined) body.response_format = args.responseFormat
    if (args.provider !== undefined) body.provider = args.provider
    if (args.temperature !== undefined) body.temperature = args.temperature
    return body
  }

  /**
   * Read a status-200 body into either a usable result or a terminal error.
   * A `length` or `content_filter` finish reason, and an empty completion, are
   * each thrown as a typed `OpenRouterError` the endpoint maps to `model-error`.
   */
  private readSuccess (body: ApiResponse): Attempt {
    const choice = body.choices?.[0]
    const finishReason = choice?.finish_reason ?? null
    if (finishReason === 'length') {
      throw new OpenRouterError(200, 'finish-length', 'completion truncated (finish_reason: length)', body)
    }
    if (finishReason === 'content_filter') {
      throw new OpenRouterError(
        200, 'finish-content-filter', 'completion blocked (finish_reason: content_filter)', body
      )
    }
    if (finishReason === 'error') {
      throw new OpenRouterError(200, 'finish-error', 'provider failed the completion (finish_reason: error)', body)
    }
    const text = choice?.message?.content ?? ''
    if (text.trim() === '') {
      throw new OpenRouterError(200, 'empty-completion', 'empty completion', body)
    }
    const u = body.usage ?? {}
    return {
      kind: 'result',
      result: {
        text,
        model: body.model ?? this.cfg.model,
        usage: {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          totalTokens: u.total_tokens ?? 0,
          cost: u.cost ?? 0,
          cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0
        }
      }
    }
  }
}

/**
 * Classify a thrown fetch or body-read error. A caller-requested abort
 * propagates untouched; anything else (a transport fault or the internal
 * timeout abort) becomes a transient retry signal.
 */
function transportRetry (args: CompleteArgs, err: unknown): Attempt {
  if (args.abortSignal?.aborted === true) throw err
  const message = err instanceof Error ? err.message : String(err)
  return {
    kind: 'retry',
    error: new OpenRouterError(0, 'transport', message),
    retryAfterMs: null
  }
}

async function safeJson (res: Response): Promise<ApiErrorBody | null> {
  try {
    return await res.json() as ApiErrorBody
  } catch {
    return null
  }
}

function backoffMs (attempt: number, retryAfterMs: number | null, random: () => number): number {
  const base = BACKOFF_LADDER[Math.min(attempt, BACKOFF_LADDER.length - 1)]
  const jitteredBase = base * (0.5 + random() * 0.5)
  return Math.max(jitteredBase, retryAfterMs ?? 0)
}

/**
 * Resolve after `ms`, or reject early with the caller's abort reason if the
 * signal trips first. Used for the inter-attempt backoff wait.
 */
function delay (ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal === undefined) {
      setTimeout(resolve, ms)
      return
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
