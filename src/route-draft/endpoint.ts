/**
 * The AI route-draft endpoint.
 *
 * `POST /api/route-draft` takes a plain-language passage request plus the
 * vessel position, the visible chart bounds, and a units hint, asks OpenRouter
 * (with structured outputs) for the route's turning waypoints, then checks the
 * draft against NOAA ENC charted depth, land, and point hazards and computes
 * the distance and fuel in owned code. The model proposes; this code disposes:
 * every safety flag and every number is set here, never by the model.
 *
 * The route is admin-gated through the shared `/api` gate (see
 * {@link ensureApiAdminGate}), the same gate the status route uses, which is the
 * intended scope: drafting spends the OpenRouter budget, an owner-level action.
 * If the gate cannot be installed the route fails closed (unmounted) rather
 * than exposing an unauthenticated spend endpoint.
 */

import type { IRouter, Request, Response } from 'express'
import type { ServerAPI } from '@signalk/server-api'
import { ensureApiAdminGate } from '../status/admin-gate.js'
import { isInUsWaters } from '../shared/us-waters.js'
import { finiteOrUndefined, isFiniteNumber } from '../shared/numbers.js'
import { presentString } from '../shared/strings.js'
import { METERS_PER_NAUTICAL_MILE } from '../shared/length.js'
import { MS_PER_SECOND } from '../shared/time.js'
import { toPosition } from '../geo/position-utilities.js'
import type { Position } from '../shared/types.js'
import type { EncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import { queryChartedAreas } from '../inputs/noaa-enc/depth-area-query.js'
import { scanRouteCorridor } from '../outputs/route-hazard/route-corridor.js'
import type { ScaleBand } from '../shared/scale-band.js'
import { OpenRouterError } from './openrouter.js'
import type { CompleteResult, OpenRouterClient } from './openrouter.js'
import type { BudgetTracker } from './budget.js'
import type { RouteDraftConfig } from './config.js'
import { checkLegs } from './safety-check.js'
import type { LegFlag } from './safety-check.js'
import { estimateFuel, routeDistanceMeters } from './fuel.js'

/**
 * Usage bands the depth check queries, finest first. Best-band picks the finest with coverage and,
 * where bands overlap, the shallower DRVAL1. Harbour is included so harbour and river passages get
 * charted coverage; berthing is excluded because its dense polygons add seconds for no added reach.
 */
const DEPTH_BANDS: ScaleBand[] = ['harbour', 'approach', 'coastal', 'general']

/** Half-width of the point-hazard corridor either side of a leg, about a quarter nautical mile. */
const CORRIDOR_HALF_WIDTH_METERS = 0.25 * METERS_PER_NAUTICAL_MILE

/**
 * Whole-request deadline, split across the LLM call and the safety check. The
 * OpenRouter client caps a single LLM request at 20 seconds (see plugin.ts), so
 * this sits just above that: a fast LLM leaves the bulk of the budget for the
 * depth and hazard check, and a near-timeout LLM lets the check degrade to an
 * honest "not checked" rather than overrunning the calling Binnacle webapp's
 * own request timeout.
 */
const REQUEST_DEADLINE_MS = 22_000

/** Output-token ceiling sized for a worst-case schema-conformant draft (waypoints, names, and a note). */
const MAX_OUTPUT_TOKENS = 1500

/** Low sampling temperature for repeatable coordinates: the draft wants determinism, not variety. */
const ROUTE_DRAFT_TEMPERATURE = 0.2

/**
 * Known-good models that support strict structured outputs, in preference
 * order. The configured model leads each request and these follow it (see
 * {@link modelsForRequest}), so OpenRouter falls through to a capable model when
 * the configured one cannot honor the strict response_format. When the
 * configured model already appears here (the default does), the duplicate is
 * removed, so the list is the fallback chain regardless of which model leads.
 */
const FALLBACK_MODELS = ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash']

/** Max turning waypoints kept from a draft. The schema and the parser share it. */
const MAX_WAYPOINTS = 25
/** Max length of a waypoint name. The schema and the parser share it. */
const MAX_WAYPOINT_NAME = 60
/** Max length of the route name and the destination name. The schema and the parser share it. */
const MAX_NAME = 80
/** Max length of the route note. The schema and the parser share it. */
const MAX_NOTE = 600

/**
 * The structured-output schema. The model returns only turning waypoints; flags
 * come from the check. The optional top-level fields, plus the range and length
 * keywords, suit the Gemini default and fallbacks, which honor them under strict
 * mode. An OpenAI-family model set as a custom routeDraftModel would reject this
 * strict schema with a 400 (it requires every property to appear in `required`,
 * and rejects those keywords). The parser re-clamps every bound, so nothing here
 * relies on server-side enforcement.
 */
const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['waypoints', 'note'],
  properties: {
    waypoints: {
      type: 'array',
      maxItems: MAX_WAYPOINTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          name: { type: 'string', maxLength: MAX_WAYPOINT_NAME }
        }
      }
    },
    destination: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string', maxLength: MAX_NAME } }
    },
    name: { type: 'string', maxLength: MAX_NAME },
    note: { type: 'string', maxLength: MAX_NOTE },
    confidence: { type: 'string', enum: ['high', 'low'] }
  }
}

/** The request's model list: the configured model first, then the known-good fallbacks, deduped. */
export function modelsForRequest (configuredModel: string): string[] {
  return [...new Set([configuredModel, ...FALLBACK_MODELS])]
}

/** The per-run state the handler reads, built at plugin start when the key is set. */
export interface RouteDraftService {
  /** The OpenRouter client, built from the configured key and model. */
  llm: OpenRouterClient
  /** The daily call-count budget, loaded from the plugin data dir. */
  budget: BudgetTracker
  /** The ENC Direct client the depth and hazard check queries through. */
  enc: EncDirectClient
  /** The resolved route-draft configuration (vessel, fuel, and routing settings). */
  config: RouteDraftConfig
  /**
   * The request's deduped model list (configured model first, then the
   * known-good fallbacks), computed once at construction since the configured
   * model is fixed for the service's lifetime.
   */
  models: string[]
}

/** The stable five-case error vocabulary the Binnacle client maps: budget, no-route, model-error, unauthorized, and bad-request. */
type DraftErrorCode = 'budget' | 'no-route' | 'model-error' | 'unauthorized' | 'bad-request'

interface ParsedRequest {
  prompt: string
  from: Position
  bounds: [number, number, number, number]
  units: 'metric' | 'imperial'
}

function fail (res: Response, status: number, error: DraftErrorCode, message: string): void {
  res.status(status).json({ ok: false, error, message })
}

/** Validate the request body into a ParsedRequest, or describe what is wrong. Exported for the endpoint trust-boundary tests. */
export function parseRequest (body: unknown): ParsedRequest | { error: string } {
  if (body === null || typeof body !== 'object') return { error: 'a JSON body is required' }
  const b = body as Record<string, unknown>
  const prompt = presentString(b.prompt)
  if (prompt === undefined) return { error: 'prompt is required' }
  const from = toPosition(b.from)
  if (from === null) {
    return { error: 'from.latitude and from.longitude must be valid coordinates' }
  }
  const bounds = b.bounds
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(isFiniteNumber)
  ) {
    return { error: 'bounds must be a [west, south, east, north] number array' }
  }
  const units = b.units === 'imperial' ? 'imperial' : 'metric'
  return {
    prompt,
    from,
    bounds: bounds as [number, number, number, number],
    units
  }
}

/** Read the leaf value of a SignalK `{ value }` node as a finite number, else undefined. */
function leafNumber (node: unknown): number | undefined {
  if (node !== null && typeof node === 'object' && 'value' in node) {
    return finiteOrUndefined((node as { value: unknown }).value)
  }
  return undefined
}

/**
 * Resolve the vessel draft in meters: the configured value when set, else the
 * server's `design.draft.value.maximum` (the deepest, safety-relevant figure),
 * else zero. The config is the primary source because design.draft is commonly
 * unpopulated on a stock server.
 */
function resolveDraftMeters (app: ServerAPI, config: RouteDraftConfig): number {
  if (config.routeDraftDraftMeters > 0) return config.routeDraftDraftMeters
  try {
    const v = app.getSelfPath('design.draft.value.maximum')
    if (isFiniteNumber(v)) return v
  } catch {
    // design.draft is optional; fall through to zero.
  }
  return 0
}

/**
 * Sum the fuel aboard across `tanks.fuel.*` in liters, preferring `currentVolume`
 * (cubic meters) and otherwise `capacity` times `currentLevel`. Returns undefined
 * when no usable tank reading is found, so the fuel estimate omits the margin
 * rather than reporting against a fabricated zero.
 */
function readFuelAboardLiters (app: ServerAPI): number | undefined {
  let tree: unknown
  try {
    tree = app.getSelfPath('tanks.fuel')
  } catch {
    return undefined
  }
  if (tree === null || typeof tree !== 'object') return undefined
  let liters = 0
  let found = false
  for (const node of Object.values(tree as Record<string, unknown>)) {
    if (node === null || typeof node !== 'object') continue
    const tank = node as Record<string, unknown>
    const currentVolume = leafNumber(tank.currentVolume)
    if (currentVolume !== undefined) {
      liters += currentVolume * 1000
      found = true
      continue
    }
    const capacity = leafNumber(tank.capacity)
    const currentLevel = leafNumber(tank.currentLevel)
    if (capacity !== undefined && currentLevel !== undefined) {
      liters += capacity * currentLevel * 1000
      found = true
    }
  }
  return found ? liters : undefined
}

const SYSTEM_PROMPT = [
  'You draft a coastal passage as an ordered list of turning waypoints. You propose intent;',
  'a downstream system performs every geometric, depth, and hazard safety check, so do not',
  'claim a route is safe. Coordinates are decimal degrees, latitude and longitude. Keep every',
  'waypoint inside the provided bounds. Prefer open water, round headlands with offing, and keep',
  'the requested standoff off the coast. For a sailing vessel respect the point of sail: do not',
  'draft a single dead-upwind leg, emit explicit tack waypoints instead, and note when a leg',
  'requires tacking. Return only the meaningful turning waypoints (named places, headlands, and',
  'channel entrances); a downstream densifier fills the rest. Put your brief rationale in note.'
].join(' ')

function buildUserPrompt (req: ParsedRequest, config: RouteDraftConfig): string {
  const [west, south, east, north] = req.bounds
  const lines = [
    `Request: ${req.prompt}`,
    `Vessel position: ${req.from.latitude.toFixed(5)}, ${req.from.longitude.toFixed(5)} (decimal degrees).`,
    `Stay within bounds west ${west}, south ${south}, east ${east}, north ${north}.`,
    `Propulsion: ${config.routeDraftPropulsion}. Cruise speed ${config.routeDraftCruiseSpeedKn} knots.`,
    `Keep about ${config.routeDraftStandoffNm} nautical miles off charted land.`,
    `Add an intermediate turning waypoint on any leg longer than ${config.routeDraftMaxLegNm} nautical miles.`
  ]
  // A sailing or motorsailing vessel respects its point of sail, so pass the
  // configured closest-hauled angle the panel presents as guidance to the
  // model: treat a leg within that angle of dead upwind as needing tacks.
  if (config.routeDraftPropulsion !== 'power') {
    lines.push(
      `This vessel sails: its closest-hauled tacking angle is about ${config.routeDraftTackingAngleDeg} degrees off the true wind, so emit explicit tack waypoints rather than a single leg within that angle of dead upwind.`
    )
  }
  lines.push(`Units for any prose: ${req.units}.`)
  return lines.join('\n')
}

interface DraftedRoute {
  waypoints: Array<{ latitude: number, longitude: number, name?: string }>
  destination?: { name: string }
  name?: string
  note: string
  confidence?: 'high' | 'low'
}

/**
 * True when `[lat, lon]` lies within the requested chart window expanded by a
 * generous margin (the window's own span on each side, at least one degree), so
 * a legitimate just-off-screen turn survives while a hallucinated point far from
 * the requested area is dropped. The longitude bound is skipped when the window
 * wraps the antimeridian (west > east), where a plain comparison would wrongly
 * reject valid points.
 */
function withinRequestBounds (
  lat: number,
  lon: number,
  [west, south, east, north]: [number, number, number, number]
): boolean {
  const latLo = Math.min(south, north)
  const latHi = Math.max(south, north)
  const latMargin = Math.max(latHi - latLo, 1)
  if (lat < latLo - latMargin || lat > latHi + latMargin) return false
  if (west <= east) {
    const lonMargin = Math.max(east - west, 1)
    if (lon < west - lonMargin || lon > east + lonMargin) return false
  }
  return true
}

/**
 * Parse and clamp the model's JSON. OpenRouter does not enforce the schema's
 * maxItems or maxLength, so the bounds are applied here: drop malformed or
 * out-of-range waypoints, drop any waypoint grossly outside the requested chart
 * window (a hallucination, since the prompt tells the model to stay in bounds),
 * cap the count, and keep only the recognized fields. Returns undefined when
 * fewer than two valid waypoints survive. Exported for the endpoint
 * trust-boundary tests.
 */
export function parseDraftedRoute (
  text: string,
  bounds: [number, number, number, number]
): DraftedRoute | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.waypoints)) return undefined
  const waypoints: DraftedRoute['waypoints'] = []
  for (const item of r.waypoints) {
    const position = toPosition(item)
    if (position === null) continue
    if (!withinRequestBounds(position.latitude, position.longitude, bounds)) continue
    const wp = item as Record<string, unknown>
    waypoints.push({
      ...position,
      ...(typeof wp.name === 'string' ? { name: wp.name.slice(0, MAX_WAYPOINT_NAME) } : {})
    })
    if (waypoints.length >= MAX_WAYPOINTS) break
  }
  if (waypoints.length < 2) return undefined
  const destination =
    r.destination !== null &&
    typeof r.destination === 'object' &&
    typeof (r.destination as Record<string, unknown>).name === 'string'
      ? { name: ((r.destination as Record<string, unknown>).name as string).slice(0, MAX_NAME) }
      : undefined
  return {
    waypoints,
    note: typeof r.note === 'string' ? r.note.slice(0, MAX_NOTE) : '',
    ...(typeof r.name === 'string' ? { name: r.name.slice(0, MAX_NAME) } : {}),
    ...(destination !== undefined ? { destination } : {}),
    ...(r.confidence === 'high' || r.confidence === 'low' ? { confidence: r.confidence } : {})
  }
}

/**
 * Map an OpenRouterError onto the contract code. Only HTTP 401, an invalid or
 * missing key, is an auth failure. OpenRouter's 403 is a moderation or
 * permission block and 402 is an empty credit balance, neither of which the
 * navigator fixes by re-checking the key, so those, the transient-exhausted
 * statuses, the unusable finish reasons (length, content_filter, error, empty),
 * and transport faults all map to model-error. Exported for the endpoint
 * trust-boundary tests.
 */
export function openRouterErrorCode (err: OpenRouterError): { status: number, error: DraftErrorCode } {
  if (err.kind === 'http' && err.status === 401) return { status: 401, error: 'unauthorized' }
  return { status: 502, error: 'model-error' }
}

/**
 * The user-facing message for a terminal OpenRouter failure, naming the cause an
 * operator can act on. A 401 is a bad or missing key, a 402 is an empty credit
 * balance, and a 403 is a moderation or permission block (not auth), so each
 * gets a distinct message rather than the generic fallback. Exported for the
 * endpoint trust-boundary tests.
 */
export function draftFailureMessage (err: OpenRouterError): string {
  if (err.kind === 'http') {
    if (err.status === 401) return 'OpenRouter rejected the configured API key. An administrator must check the key in the Crow\'s Nest plugin.'
    if (err.status === 402) return 'The OpenRouter account is out of credits. Add credits in the OpenRouter dashboard, then try again.'
    if (err.status === 403) return 'The AI request was refused, possibly blocked by content moderation. Try rephrasing the passage request.'
  }
  return `The AI service failed: ${err.message}`
}

/** Race a promise against a deadline, resolving to `onTimeout()` if the deadline wins. */
async function withDeadline<T> (work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms))
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    // The Promise executor runs synchronously, so timer is always set by here;
    // clearTimeout also tolerates undefined, so the call needs no guard.
    clearTimeout(timer)
  }
}

async function handleDraft (
  app: ServerAPI,
  service: RouteDraftService,
  req: Request,
  res: Response
): Promise<void> {
  const parsed = parseRequest(req.body)
  if ('error' in parsed) {
    fail(res, 400, 'bad-request', parsed.error)
    return
  }
  if (!service.budget.canSpend()) {
    fail(res, 200, 'budget', 'The daily AI route-drafting budget is used up. Try again tomorrow, or raise the cap in the Crow\'s Nest plugin.')
    return
  }
  await service.budget.recordCall()

  // One deadline timestamp for the whole request, split across the LLM call and
  // the safety check, so the remaining budget is read off a single source.
  const deadlineMs = Date.now() + REQUEST_DEADLINE_MS
  const config = service.config

  let completion: CompleteResult
  try {
    completion = await service.llm.complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(parsed, config),
      responseFormat: { type: 'json_schema', json_schema: { name: 'route_draft', strict: true, schema: ROUTE_SCHEMA } },
      models: service.models,
      provider: { require_parameters: true },
      temperature: ROUTE_DRAFT_TEMPERATURE,
      maxTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(Math.max(MS_PER_SECOND, deadlineMs - Date.now()))
    })
  } catch (err) {
    if (err instanceof OpenRouterError) {
      const mapped = openRouterErrorCode(err)
      fail(res, mapped.status, mapped.error, draftFailureMessage(err))
      return
    }
    // An unexpected (non-OpenRouter) throw keeps its detail server-side rather
    // than reflecting an internal string back to the caller. Log the stack when
    // present, since it is the only diagnostic for an unexpected failure path.
    app.error(`route-draft LLM call failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    fail(res, 502, 'model-error', 'The AI request failed unexpectedly.')
    return
  }
  // Log the model that actually served the draft and its cost, so a silent
  // fallback to a different model in the list is visible in the server log.
  app.debug(
    `route-draft served by ${completion.model}, cost ${completion.usage.cost}, ` +
    `cached tokens ${completion.usage.cachedTokens}`
  )

  const route = parseDraftedRoute(completion.text, parsed.bounds)
  if (route === undefined) {
    fail(res, 200, 'no-route', 'The AI could not draft a usable route for that. Try rephrasing, or a shorter passage.')
    return
  }

  const positions: Position[] = route.waypoints.map((wp) => ({ latitude: wp.latitude, longitude: wp.longitude }))

  // The deterministic safety check, bounded by the remaining request budget. If
  // it overruns, the route still returns with an honest "not checked" flag, and
  // the abort controller cancels the in-flight ENC queries so the abandoned
  // check leaves no orphaned upstream requests running.
  const checkBudget = deadlineMs - Date.now()
  const draftMeters = resolveDraftMeters(app, config)
  const checkAbort = new AbortController()
  const check = await withDeadline(
    checkLegs(
      {
        client: service.enc,
        queryChartedAreas,
        scanRouteCorridor,
        isInUsWaters,
        logger: { debug: (m: string) => { app.debug(m) }, error: (m: string) => { app.error(m) } }
      },
      {
        waypoints: positions,
        draftMeters,
        safetyMarginMeters: config.routeDraftSafetyMarginMeters,
        standoffNm: config.routeDraftStandoffNm,
        corridorHalfWidthMeters: CORRIDOR_HALF_WIDTH_METERS,
        bands: DEPTH_BANDS,
        signal: checkAbort.signal
      }
    ),
    checkBudget,
    () => {
      checkAbort.abort()
      return { flags: [{ kind: 'other' as const, message: 'depth and hazards not checked: the check timed out, verify every leg on the chart' }], checked: false }
    }
  )

  const fuel = computeFuel(app, config, routeDistanceMeters(positions))

  res.json({
    ok: true,
    waypoints: route.waypoints,
    ...(route.destination !== undefined ? { destination: route.destination } : {}),
    ...(route.name !== undefined ? { name: route.name } : {}),
    note: route.note,
    ...(route.confidence !== undefined ? { confidence: route.confidence } : {}),
    ...(fuel !== undefined ? { fuel } : {}),
    ...(check.flags.length > 0 ? { flags: orderFlags(check.flags) } : {})
  })
}

/** Flag display order, most safety-critical first. */
const FLAG_RANK: Record<LegFlag['kind'], number> = { land: 0, shallow: 1, hazard: 2, other: 3 }

/** Order flags so the most safety-critical read first: land, shallow, hazard, then other. */
function orderFlags (flags: LegFlag[]): LegFlag[] {
  return [...flags].sort((a, b) => FLAG_RANK[a.kind] - FLAG_RANK[b.kind])
}

/** The contract fuel object, or undefined when no honest estimate is possible. */
function computeFuel (
  app: ServerAPI,
  config: RouteDraftConfig,
  distanceMeters: number
): { neededL: number, aboardL?: number, marginPct?: number, derateNote: string } | undefined {
  const estimate = estimateFuel({
    routeDistanceMeters: distanceMeters,
    propulsion: config.routeDraftPropulsion,
    cruiseSpeedKn: config.routeDraftCruiseSpeedKn,
    burnAtCruise: config.routeDraftBurnLitersPerHour,
    reservePercent: config.routeDraftReservePercent,
    fuelAboardLiters: readFuelAboardLiters(app)
  })
  if ('reason' in estimate) return undefined
  return estimate
}

/**
 * Build the route-draft route registrar. It mounts `POST /api/route-draft` on
 * the shared plugin router, guarded against a double mount the same way the
 * status router is. The route is admin-gated through the shared `/api` gate: the
 * route mounts only once the gate is in place, so a gate that cannot be
 * installed leaves no ungated spend endpoint behind. The handler returns
 * `unauthorized` when the service is absent (no key configured, or the plugin
 * not started).
 */
export function createRouteDraftRouter (
  app: ServerAPI,
  getService: () => RouteDraftService | undefined
): (router: IRouter) => void {
  const mounted = new WeakSet<IRouter>()
  return (router: IRouter): void => {
    if (!ensureApiAdminGate(app)) {
      app.error(
        'Route-draft API unavailable: POST /api/route-draft was not mounted because it could not be admin-gated'
      )
      return
    }
    if (mounted.has(router)) return
    router.post('/api/route-draft', (req: Request, res: Response): void => {
      const service = getService()
      if (service === undefined) {
        fail(res, 401, 'unauthorized', 'AI route drafting is not configured. An administrator must enable it and set the OpenRouter key in the Crow\'s Nest plugin.')
        return
      }
      handleDraft(app, service, req, res).catch((err) => {
        app.error(`route-draft handler failed: ${String(err)}`)
        if (!res.headersSent) fail(res, 500, 'model-error', 'The route-draft handler failed unexpectedly.')
      })
    })
    mounted.add(router)
  }
}
