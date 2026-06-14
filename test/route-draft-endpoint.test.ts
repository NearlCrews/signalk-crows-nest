import test from 'node:test'
import assert from 'node:assert/strict'
import {
  draftFailureMessage,
  modelsForRequest,
  openRouterErrorCode,
  parseDraftedRoute,
  parseRequest
} from '../src/route-draft/endpoint.js'
import { OpenRouterError } from '../src/route-draft/openrouter.js'
import { DEFAULT_ROUTE_DRAFT_MODEL } from '../src/route-draft/config.js'

/** A Boston-area chart window: [west, south, east, north]. */
const BOUNDS: [number, number, number, number] = [-71, 42, -70, 43]

/** A valid request body the panel/Binnacle would post. */
function requestBody (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: '  to Provincetown, 2 nm off the coast  ',
    from: { latitude: 42.35, longitude: -70.99 },
    bounds: BOUNDS,
    units: 'imperial',
    ...overrides
  }
}

/** A model completion with the given waypoints, as the JSON string the LLM returns. */
function draft (waypoints: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ waypoints, note: 'rationale', ...extra })
}

// --- parseRequest -------------------------------------------------------------

test('parseRequest accepts a valid body, trims the prompt, and keeps the units', () => {
  const parsed = parseRequest(requestBody())
  assert.ok(!('error' in parsed))
  assert.equal(parsed.prompt, 'to Provincetown, 2 nm off the coast')
  assert.deepEqual(parsed.from, { latitude: 42.35, longitude: -70.99 })
  assert.deepEqual(parsed.bounds, BOUNDS)
  assert.equal(parsed.units, 'imperial')
})

test('parseRequest defaults units to metric for anything but imperial', () => {
  const parsed = parseRequest(requestBody({ units: 'furlongs' }))
  assert.ok(!('error' in parsed))
  assert.equal(parsed.units, 'metric')
})

test('parseRequest rejects a non-object body', () => {
  assert.ok('error' in parseRequest(null))
  assert.ok('error' in parseRequest('not json'))
})

test('parseRequest rejects a missing or blank prompt', () => {
  assert.ok('error' in parseRequest(requestBody({ prompt: '   ' })))
  assert.ok('error' in parseRequest(requestBody({ prompt: 42 })))
})

test('parseRequest rejects a missing or out-of-range from position', () => {
  assert.ok('error' in parseRequest(requestBody({ from: undefined })))
  assert.ok('error' in parseRequest(requestBody({ from: { latitude: 42 } })))
  assert.ok('error' in parseRequest(requestBody({ from: { latitude: 91, longitude: 0 } })))
  assert.ok('error' in parseRequest(requestBody({ from: { latitude: 0, longitude: 181 } })))
})

test('parseRequest rejects bounds that are not four finite numbers', () => {
  assert.ok('error' in parseRequest(requestBody({ bounds: [-71, 42, -70] })))
  assert.ok('error' in parseRequest(requestBody({ bounds: [-71, 42, -70, 'north'] })))
})

test('parseRequest accepts a normal regional bounds window', () => {
  // A 1-degree-square Boston-area window must pass.
  assert.ok(!('error' in parseRequest(requestBody({ bounds: BOUNDS }))))
})

test('parseRequest rejects an over-wide longitude window', () => {
  // 200-degree span: far larger than any real chart viewport.
  assert.ok('error' in parseRequest(requestBody({ bounds: [-100, 42, 100, 43] })))
})

test('parseRequest rejects an over-tall latitude window', () => {
  // 130-degree span: exceeds the 120-degree cap.
  assert.ok('error' in parseRequest(requestBody({ bounds: [-71, -70, -70, 60] })))
})

test('parseRequest rejects an inverted-latitude window (north <= south)', () => {
  // north equal to south is a zero-height window, which must be rejected.
  assert.ok('error' in parseRequest(requestBody({ bounds: [-71, 43, -70, 43] })))
  // north less than south is inverted.
  assert.ok('error' in parseRequest(requestBody({ bounds: [-71, 43, -70, 42] })))
})

test('parseRequest accepts a legitimate antimeridian-crossing window', () => {
  // west 160, south 0, east -160, north 20: the short-way longitude span is
  // ((-160 + 360) - 160) = 40 degrees, well within the cap.
  assert.ok(!('error' in parseRequest(requestBody({ bounds: [160, 0, -160, 20] }))))
})

// --- parseDraftedRoute --------------------------------------------------------

test('parseDraftedRoute parses a valid two-waypoint route with its optional fields', () => {
  const route = parseDraftedRoute(
    draft(
      [
        { latitude: 42.4, longitude: -70.9, name: 'Start' },
        { latitude: 42.7, longitude: -70.8 }
      ],
      { name: 'Coastal hop', destination: { name: 'Provincetown' }, confidence: 'high' }
    ),
    BOUNDS
  )
  assert.ok(route !== undefined)
  assert.equal(route.waypoints.length, 2)
  assert.equal(route.waypoints[0].name, 'Start')
  assert.equal(route.name, 'Coastal hop')
  assert.deepEqual(route.destination, { name: 'Provincetown' })
  assert.equal(route.confidence, 'high')
})

test('parseDraftedRoute returns undefined for non-JSON or a non-object payload', () => {
  assert.equal(parseDraftedRoute('not json', BOUNDS), undefined)
  assert.equal(parseDraftedRoute('42', BOUNDS), undefined)
  assert.equal(parseDraftedRoute('{}', BOUNDS), undefined)
})

test('parseDraftedRoute returns undefined when fewer than two valid waypoints survive', () => {
  assert.equal(
    parseDraftedRoute(draft([{ latitude: 42.4, longitude: -70.9 }]), BOUNDS),
    undefined
  )
})

test('parseDraftedRoute drops a waypoint outside the global coordinate envelope', () => {
  const route = parseDraftedRoute(
    draft([
      { latitude: 42.4, longitude: -70.9 },
      { latitude: 999, longitude: -70.8 },
      { latitude: 42.7, longitude: -70.85 }
    ]),
    BOUNDS
  )
  assert.ok(route !== undefined)
  assert.equal(route.waypoints.length, 2, 'the out-of-range waypoint is dropped')
})

test('parseDraftedRoute drops a hallucinated waypoint far outside the requested chart window', () => {
  const route = parseDraftedRoute(
    draft([
      { latitude: 42.4, longitude: -70.9 },
      { latitude: 10, longitude: 100 },
      { latitude: 42.7, longitude: -70.85 }
    ]),
    BOUNDS
  )
  assert.ok(route !== undefined)
  assert.equal(route.waypoints.length, 2, 'the far-off-window waypoint is dropped, not snapped')
})

test('parseDraftedRoute keeps a legitimate just-off-window waypoint within the margin', () => {
  // 42.9 is north of the window (43) but inside the one-degree margin.
  const route = parseDraftedRoute(
    draft([
      { latitude: 42.4, longitude: -70.9 },
      { latitude: 43.9, longitude: -70.8 }
    ]),
    BOUNDS
  )
  assert.ok(route !== undefined)
  assert.equal(route.waypoints.length, 2)
})

test('parseDraftedRoute caps the waypoint count and slices an over-long name', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    latitude: 42.4 + i * 0.001,
    longitude: -70.9,
    name: 'x'.repeat(100)
  }))
  const route = parseDraftedRoute(draft(many), BOUNDS)
  assert.ok(route !== undefined)
  assert.equal(route.waypoints.length, 25, 'the count is capped at the schema maximum')
  assert.equal(route.waypoints[0].name?.length, 60, 'a waypoint name is sliced to the schema maximum')
})

// --- openRouterErrorCode ------------------------------------------------------

test('openRouterErrorCode maps only 401 to unauthorized', () => {
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(401, 'http', 'no key')), { status: 401, error: 'unauthorized' })
})

test('openRouterErrorCode maps a 403 moderation or permission block to model-error, not auth', () => {
  // OpenRouter's 403 is a guardrail or moderation flag, not an auth failure, so it
  // must not steer the operator toward fixing the API key.
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(403, 'http', 'flagged')), { status: 502, error: 'model-error' })
})

test('draftFailureMessage names the cause for 401, 402, and 403, and falls back otherwise', () => {
  assert.match(draftFailureMessage(new OpenRouterError(401, 'http', 'no key')), /key/i)
  assert.match(draftFailureMessage(new OpenRouterError(402, 'http', 'no credits')), /credits/i)
  assert.match(draftFailureMessage(new OpenRouterError(403, 'http', 'flagged')), /moderation/i)
  assert.equal(draftFailureMessage(new OpenRouterError(500, 'http', 'boom')), 'The AI service failed: boom')
  assert.equal(draftFailureMessage(new OpenRouterError(0, 'transport', 'network down')), 'The AI service failed: network down')
})

test('openRouterErrorCode maps out-of-credits and other terminal statuses to model-error', () => {
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(402, 'http', 'no credits')), { status: 502, error: 'model-error' })
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(500, 'http', 'server')), { status: 502, error: 'model-error' })
})

test('openRouterErrorCode maps unusable completions and transport faults to model-error', () => {
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(200, 'finish-length', 'truncated')), { status: 502, error: 'model-error' })
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(200, 'empty-completion', 'blank')), { status: 502, error: 'model-error' })
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(0, 'transport', 'network')), { status: 502, error: 'model-error' })
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(200, 'finish-content-filter', 'filtered')), { status: 502, error: 'model-error' })
  assert.deepEqual(openRouterErrorCode(new OpenRouterError(200, 'finish-error', 'provider error')), { status: 502, error: 'model-error' })
})

// --- modelsForRequest ---------------------------------------------------------

test('modelsForRequest puts the configured model first and appends the fallbacks', () => {
  const custom = 'openai/gpt-4o'
  const list = modelsForRequest(custom)
  assert.equal(list[0], custom, 'the configured model leads')
  assert.ok(list.includes('google/gemini-2.5-flash-lite'), 'the first fallback is included')
  assert.ok(list.includes('google/gemini-2.5-flash'), 'the second fallback is included')
})

test('modelsForRequest with the default model has no duplicate and returns exactly two entries', () => {
  const list = modelsForRequest(DEFAULT_ROUTE_DRAFT_MODEL)
  assert.equal(list.length, 2, 'the default model is not duplicated in the fallback list')
  assert.equal(new Set(list).size, 2, 'all entries are distinct')
})
