import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorRouteEndpoints,
  buildUserPrompt,
  draftFailureMessage,
  modelsForRequest,
  openRouterErrorCode,
  parseDraftedRoute,
  parseRequest
} from '../src/route-draft/endpoint.js'
import { OpenRouterError } from '../src/route-draft/openrouter.js'
import { DEFAULT_ROUTE_DRAFT_MODEL, normalizeRouteDraftConfig } from '../src/route-draft/config.js'

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

/** A drawn route the optimize variant carries. */
const DRAWN: Array<{ latitude: number, longitude: number }> = [
  { latitude: 42.35, longitude: -70.99 },
  { latitude: 42.5, longitude: -70.7 },
  { latitude: 42.7, longitude: -70.5 }
]

/** A fully defaulted route-draft config for the prompt-shape tests. */
const TEST_CONFIG = normalizeRouteDraftConfig({})

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

// --- parseRequest: the optimize route field -----------------------------------

test('parseRequest accepts a valid route to optimize and keeps its waypoints', () => {
  const parsed = parseRequest(requestBody({ route: DRAWN }))
  assert.ok(!('error' in parsed))
  assert.deepEqual(parsed.route, DRAWN)
})

test('parseRequest makes the prompt optional when a route is given (the hint is optional)', () => {
  const blank = parseRequest(requestBody({ route: DRAWN, prompt: '   ' }))
  assert.ok(!('error' in blank))
  assert.equal(blank.prompt, '', 'a blank hint becomes an empty string')
  const missing = parseRequest(requestBody({ route: DRAWN, prompt: undefined }))
  assert.ok(!('error' in missing))
  assert.equal(missing.prompt, '')
})

test('parseRequest still requires a prompt when no route is given', () => {
  assert.ok('error' in parseRequest(requestBody({ prompt: undefined })))
})

test('parseRequest rejects a non-array route', () => {
  assert.ok('error' in parseRequest(requestBody({ route: 'nope' })))
})

test('parseRequest rejects a route with an invalid coordinate', () => {
  assert.ok('error' in parseRequest(requestBody({
    route: [{ latitude: 42, longitude: -70 }, { latitude: 91, longitude: 0 }]
  })))
})

test('parseRequest rejects a route with fewer than two waypoints', () => {
  assert.ok('error' in parseRequest(requestBody({ route: [{ latitude: 42, longitude: -70 }] })))
})

test('parseRequest rejects a route over the waypoint cap', () => {
  const tooMany = Array.from({ length: 26 }, (_, i) => ({ latitude: 42 + i * 0.01, longitude: -70 }))
  assert.ok('error' in parseRequest(requestBody({ route: tooMany })))
})

test('parseRequest accepts a route at exactly the waypoint cap', () => {
  const exactly = Array.from({ length: 25 }, (_, i) => ({ latitude: 42 + i * 0.01, longitude: -70 }))
  assert.ok(!('error' in parseRequest(requestBody({ route: exactly }))))
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

test('parseDraftedRoute tolerates the null optional fields the cross-provider schema can emit', () => {
  // The strict-clean schema makes name and destination required-but-nullable, so a model returns null
  // rather than omitting them; the parser drops a null the same as a missing value. confidence is a
  // plain enum now, but the parser still drops a stray null defensively, which this also covers.
  const route = parseDraftedRoute(
    JSON.stringify({
      waypoints: [
        { latitude: 42.4, longitude: -70.9, name: null },
        { latitude: 42.7, longitude: -70.8, name: null }
      ],
      destination: null,
      name: null,
      note: 'rationale',
      confidence: null
    }),
    BOUNDS
  )
  assert.ok(route !== undefined)
  assert.equal(route.waypoints.length, 2)
  assert.equal(route.waypoints[0].name, undefined, 'a null waypoint name is dropped')
  assert.equal(route.destination, undefined)
  assert.equal(route.name, undefined)
  assert.equal(route.confidence, undefined)
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
  assert.ok(list.includes('google/gemini-2.5-flash'), 'the gemini-flash fallback is included')
  assert.ok(list.includes('google/gemini-2.5-flash-lite'), 'the gemini-flash-lite fallback is included')
})

test('modelsForRequest with the default model has no duplicate and returns exactly two entries', () => {
  const list = modelsForRequest(DEFAULT_ROUTE_DRAFT_MODEL)
  assert.equal(list.length, 2, 'the default model is not duplicated in the fallback list')
  assert.equal(new Set(list).size, 2, 'all entries are distinct')
})

// --- anchorRouteEndpoints -----------------------------------------------------

test('anchorRouteEndpoints pins the first and last waypoints to the drawn endpoints, keeping names', () => {
  const waypoints = [
    { latitude: 42.36, longitude: -70.98, name: 'Start' },
    { latitude: 42.5, longitude: -70.7 },
    { latitude: 42.71, longitude: -70.49, name: 'End' }
  ]
  anchorRouteEndpoints(waypoints, [
    { latitude: 42.35, longitude: -70.99 },
    { latitude: 42.7, longitude: -70.5 }
  ])
  assert.deepEqual(waypoints[0], { latitude: 42.35, longitude: -70.99, name: 'Start' }, 'the start is pinned, its name kept')
  assert.deepEqual(waypoints[2], { latitude: 42.7, longitude: -70.5, name: 'End' }, 'the end is pinned, its name kept')
  assert.deepEqual(waypoints[1], { latitude: 42.5, longitude: -70.7 }, 'an interior waypoint is untouched')
})

test('anchorRouteEndpoints does not throw on an empty waypoints or seed array', () => {
  const seed = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }]
  assert.doesNotThrow(() => anchorRouteEndpoints([], seed))
  assert.doesNotThrow(() => anchorRouteEndpoints([{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }], []))
})

test('anchorRouteEndpoints pins both endpoints of a two-waypoint result independently', () => {
  const waypoints = [
    { latitude: 42.36, longitude: -70.98 },
    { latitude: 42.71, longitude: -70.49 }
  ]
  anchorRouteEndpoints(waypoints, [
    { latitude: 42.35, longitude: -70.99 },
    { latitude: 42.7, longitude: -70.5 }
  ])
  assert.deepEqual(waypoints[0], { latitude: 42.35, longitude: -70.99 }, 'the first waypoint takes the drawn start')
  assert.deepEqual(waypoints[1], { latitude: 42.7, longitude: -70.5 }, 'the last waypoint takes the drawn end, not the start')
})

// --- buildUserPrompt ----------------------------------------------------------

test('buildUserPrompt uses the draft framing and the Request label when no route is given', () => {
  const parsed = parseRequest(requestBody())
  assert.ok(!('error' in parsed))
  const prompt = buildUserPrompt(parsed, TEST_CONFIG)
  assert.match(prompt, /^Request: /m)
  assert.doesNotMatch(prompt, /Improve the drawn route/)
})

test('buildUserPrompt uses the optimize framing, serializes the input, and labels the hint when a route is given', () => {
  const parsed = parseRequest(requestBody({ route: DRAWN, prompt: 'stay 3 nm off' }))
  assert.ok(!('error' in parsed))
  const prompt = buildUserPrompt(parsed, TEST_CONFIG)
  assert.match(prompt, /Improve the drawn route/)
  assert.match(prompt, /42\.35000, -70\.99000/, 'the drawn start is serialized at five decimals')
  assert.match(prompt, /42\.70000, -70\.50000/, 'the drawn end is serialized too, not only the start')
  assert.match(prompt, /Navigator's hint: stay 3 nm off/)
  assert.doesNotMatch(prompt, /^Request: /m, 'the draft Request label is not used for an optimize')
})

test('buildUserPrompt omits the hint line when the optimize prompt is blank', () => {
  const parsed = parseRequest(requestBody({ route: DRAWN, prompt: '   ' }))
  assert.ok(!('error' in parsed))
  const prompt = buildUserPrompt(parsed, TEST_CONFIG)
  assert.doesNotMatch(prompt, /Navigator's hint:/)
})

test('buildUserPrompt tells a draft to honor a named start and use the vessel position only as a fallback', () => {
  const parsed = parseRequest(requestBody())
  assert.ok(!('error' in parsed))
  const prompt = buildUserPrompt(parsed, TEST_CONFIG)
  assert.match(prompt, /If the request names a starting point, begin the route there/)
  assert.match(prompt, /from me/)
})

test('buildUserPrompt does not add the draft start-fallback guidance to an optimize', () => {
  const parsed = parseRequest(requestBody({ route: DRAWN }))
  assert.ok(!('error' in parsed))
  const prompt = buildUserPrompt(parsed, TEST_CONFIG)
  assert.doesNotMatch(prompt, /Use the vessel position below as the start only/)
})
