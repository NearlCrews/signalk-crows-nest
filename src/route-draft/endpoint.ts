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
import { finiteOrUndefined, isFiniteNumber } from '../shared/numbers.js'
import { presentString } from '../shared/strings.js'
import { METERS_PER_NAUTICAL_MILE } from '../shared/length.js'
import { MS_PER_SECOND } from '../shared/time.js'
import { toPosition } from '../geo/position-utilities.js'
import type { Position } from '../shared/types.js'
import type { EncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import type { OverpassClient } from '../inputs/openseamap/overpass-client.js'
import type { EmodnetClient } from './emodnet/emodnet-client.js'
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
import { routeChannel } from './channel-router/index.js'
import type { ChannelDeclineReason, ChannelRouteResult, TileWaterSource } from './channel-router/index.js'

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
 * OpenRouter client caps a single LLM request at 20 seconds (see plugin.ts), and
 * the worldwide check runs a bounded set of upstream queries after it (each
 * Overpass query is itself capped, see the OpenSeaMap provider), so this leaves
 * room for the LLM plus a dense route's checked legs to finish rather than degrade
 * to an honest "not checked". A channel-routed track that follows a winding river
 * can run to fifty-plus legs, whose per-leg charted-depth checks need this much
 * budget to complete; it is a ceiling, so a short route still returns quickly. It
 * stays under the calling Binnacle webapp's own request timeout (55 s), which must
 * remain the larger of the two so the server returns its result before the client
 * gives up.
 */
const REQUEST_DEADLINE_MS = 50_000

/** Output-token ceiling sized for a worst-case schema-conformant draft (waypoints, names, and a note). */
const MAX_OUTPUT_TOKENS = 1500

/**
 * Minimum remaining request budget to run the channel router. Below this the router is
 * skipped so the safety check still has time to run: the route stays the LLM or drawn
 * geometry, with the channel-unavailable note attached.
 */
const ROUTER_MIN_BUDGET_MS = 12_000

/**
 * Route-level geometry note per channel-routing outcome, so the navigator always learns
 * when channel routing did not run and why, and never mistakes a clean line for a vetted
 * one. Each speaks to geometry, distinct from the safety check's depth-not-checked note.
 * The `land-leg` case in particular is named honestly: the router DID run and found the
 * path crossed land, which warrants more caution, not less.
 */
const CHANNEL_NOTE_BY_REASON: Record<ChannelDeclineReason | 'skipped', string> = {
  'no-coverage': 'Channel routing did not run here (no charted depth or mapped water to follow), so this is the direct AI route. The legs are straight lines between waypoints, verify each one against the chart.',
  'no-path': 'Channel routing could not find a continuous water path between these points, so this is the direct AI route. Verify every leg against the chart.',
  deadline: 'Channel routing ran out of time before finding a water path, so this is the direct AI route. Verify every leg against the chart.',
  unsnappable: 'Channel routing could not place the start or end on navigable water, so this is the direct AI route. Verify every leg against the chart.',
  'land-leg': 'The auto-routed path crossed land or left charted water at the final check and was discarded, so this is the direct AI route. Treat it with extra caution and verify every leg against the chart.',
  'fetch-failed': 'Channel routing could not reach the chart data sources, so this is the direct AI route. Verify every leg against the chart.',
  skipped: 'Channel routing was skipped to keep within the time budget, so this is the direct AI route. Verify every leg against the chart.'
}

/**
 * Route-level caveat when the channel route followed mapped water outlines that carry
 * no depth. The wording does not claim the route "avoids charted land", because the
 * water outlines are generalized for display and can omit a small island or narrow
 * hazard; it describes what the router did and points the navigator at the chart.
 */
const CHANNEL_TILE_WATER_CAVEAT: LegFlag = {
  kind: 'other',
  message: 'This route was auto-routed to stay within mapped water outlines, which are generalized for display and carry no depth, so it can omit a small island or narrow hazard and is not depth-checked. Treat it as a draft and verify every leg against the chart, especially in narrow or shoal water.'
}

/**
 * Maximum latitude or longitude span of the request bounds, in degrees. A
 * route-draft viewport is regional; 120 degrees per edge is far larger than any
 * real chart window but rejects hemisphere-scale inputs and the ~358-degree
 * artifact produced by a naively computed antimeridian-crossing bounding box,
 * both of which would drive the per-route Overpass tiling into hundreds of requests.
 */
const MAX_BOUNDS_SPAN_DEG = 120

/** Low sampling temperature for repeatable coordinates: the draft wants determinism, not variety. */
const ROUTE_DRAFT_TEMPERATURE = 0.2

/**
 * An even lower temperature for an optimize: it refines a polyline the navigator
 * already shaped, so it should hew to that intent rather than explore.
 */
const ROUTE_OPTIMIZE_TEMPERATURE = 0.1

/**
 * Known-good models that support strict structured outputs, in preference
 * order. The configured model leads each request and these follow it (see
 * {@link modelsForRequest}), so OpenRouter falls through to a capable model when
 * the configured one cannot honor the strict response_format. When the
 * configured model already appears here (the default does), the duplicate is
 * removed, so the list is the fallback chain regardless of which model leads.
 */
const FALLBACK_MODELS = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite']

/** Max turning waypoints kept from a draft, enforced by the parser. */
const MAX_WAYPOINTS = 25
/** Max length of a waypoint name, enforced by the parser. */
const MAX_WAYPOINT_NAME = 60
/** Max length of the route name and the destination name, enforced by the parser. */
const MAX_NAME = 80
/** Max length of the route note, enforced by the parser. */
const MAX_NOTE = 600

/**
 * The structured-output schema, kept strict-clean so every provider's strict mode
 * accepts it, not just Gemini's. Rules learned from live cross-provider testing:
 * every property appears in `required` (an optional value is nullable rather than
 * omitted); the range and length keywords (minimum, maximum, maxItems, maxLength)
 * are dropped, since Anthropic and OpenAI strict mode reject them; and `confidence`
 * is a plain-string enum, not a nullable one, because Anthropic rejects an `enum`
 * whose values do not match a nullable union type ("Enum value 'high' does not
 * match declared type ['string', 'null']"). The parser re-validates and clamps
 * every value, so nothing here relies on server-side enforcement.
 */
const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['waypoints', 'destination', 'name', 'note', 'confidence'],
  properties: {
    waypoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['latitude', 'longitude', 'name'],
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          name: { type: ['string', 'null'] }
        }
      }
    },
    destination: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' } }
    },
    name: { type: ['string', 'null'] },
    note: { type: 'string' },
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
  /** The Overpass client the worldwide OpenSeaMap leg check queries through. */
  overpass: OverpassClient
  /** The EMODnet client the European modeled-depth leg check queries through. */
  emodnet: EmodnetClient
  /** The worldwide vector-tile water source the channel router routes over (holds the tile cache). */
  tileWater: TileWaterSource
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
  /**
   * The drawn route to optimize, ordered turning points. Its presence makes the
   * request an optimize: the model refines this polyline instead of drafting from
   * the prompt alone, and the prompt becomes an optional steering hint.
   */
  route?: Position[]
}

function fail (res: Response, status: number, error: DraftErrorCode, message: string): void {
  res.status(status).json({ ok: false, error, message })
}

/** Validate the request body into a ParsedRequest, or describe what is wrong. Exported for the endpoint trust-boundary tests. */
export function parseRequest (body: unknown): ParsedRequest | { error: string } {
  if (body === null || typeof body !== 'object') return { error: 'a JSON body is required' }
  const b = body as Record<string, unknown>
  // An optimize request carries the drawn route. Validate it first, because its
  // presence makes the plain-language prompt an optional hint rather than required.
  let route: Position[] | undefined
  if (b.route !== undefined) {
    if (!Array.isArray(b.route)) return { error: 'route must be an array of waypoints' }
    const points: Position[] = []
    for (const item of b.route) {
      const position = toPosition(item)
      if (position === null) return { error: 'route waypoints must be valid latitude and longitude coordinates' }
      points.push(position)
    }
    if (points.length < 2) return { error: 'route to optimize must have at least two waypoints' }
    if (points.length > MAX_WAYPOINTS) {
      return { error: `route to optimize has more than the ${MAX_WAYPOINTS}-waypoint limit; simplify it and try again` }
    }
    route = points
  }
  const prompt = presentString(b.prompt)
  // The prompt is required to draft from words, but optional as a steering hint when a route is given.
  if (prompt === undefined && route === undefined) return { error: 'prompt is required' }
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
  const [west, south, east, north] = bounds as [number, number, number, number]
  const latSpan = north - south
  // Antimeridian-aware longitude span: when east < west the window crosses the
  // antimeridian (e.g. west 170, east -170 is a 20-degree window), so add 360
  // to get the short-way span instead of the ~340-degree complementary arc.
  const lonSpan = east >= west ? east - west : east + 360 - west
  if (latSpan <= 0 || lonSpan <= 0 || latSpan > MAX_BOUNDS_SPAN_DEG || lonSpan > MAX_BOUNDS_SPAN_DEG) {
    return { error: 'bounds window is degenerate or too large; pan or zoom and try again' }
  }
  const units = b.units === 'imperial' ? 'imperial' : 'metric'
  return {
    prompt: prompt ?? '',
    from,
    bounds: bounds as [number, number, number, number],
    units,
    ...(route !== undefined ? { route } : {})
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
  'waypoint inside the provided bounds, and place every waypoint on navigable water, never on',
  'land. The route is straight lines between consecutive waypoints, so the line between any two',
  'must itself stay on navigable water: in a river, channel, strait, or around an island, follow',
  'the navigable channel and put a waypoint at every bend, enough that no straight leg cuts across',
  'land, an island, or a shoal. Prefer open water, round headlands with offing, and keep the',
  'requested standoff off the coast. For a sailing vessel respect the point of sail: do not draft a',
  'single dead-upwind leg, emit explicit tack waypoints instead, and note when a leg requires',
  'tacking. Return as many turning waypoints as the route needs to keep every leg on the water, not',
  'a minimal set; a downstream densifier only interpolates the straight legs, it cannot route around',
  'land. Put your brief rationale in note.'
].join(' ')

/** Serialize a position as `latitude, longitude` at five decimals, the form both prompt paths use. */
function formatCoord (p: Position): string {
  return `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`
}

/**
 * Build the user prompt for a draft or an optimize. With a drawn route present it
 * frames the task as refining that polyline, keeping the start, the destination,
 * and the intent the shape implies, and serializes the input as ordered latitude,
 * longitude lines with the prompt as an optional hint; otherwise it drafts from
 * the prompt. The vessel, bounds, propulsion, standoff, max-leg, and units
 * guidance is shared. Exported for the endpoint prompt-shape tests.
 */
export function buildUserPrompt (req: ParsedRequest, config: RouteDraftConfig): string {
  const [west, south, east, north] = req.bounds
  const lines: string[] = []
  if (req.route !== undefined) {
    lines.push(
      'Improve the drawn route below. Keep its start (the first waypoint) and its destination (the last',
      'waypoint), and the intent the shape implies. Move waypoints only as needed to clear charted',
      'shallows, land, and hazards with the requested standoff, and add turning waypoints where a leg is',
      'too long or rounds a headland. Tighten the track only where that does not reduce safety. Do not',
      'merely repeat the input. If the route already meets these goals, return it unchanged and say so in',
      'note.',
      'Drawn route, in order (latitude, longitude):'
    )
    for (const wp of req.route) {
      lines.push(`  ${formatCoord(wp)}`)
    }
    if (req.prompt !== '') lines.push(`Navigator's hint: ${req.prompt}`)
  } else {
    lines.push(
      `Request: ${req.prompt}`,
      'If the request names a starting point, begin the route there. Use the vessel position below as the start only when the request names no starting point, or asks to start from the current location (for example "from here" or "from me").'
    )
  }
  lines.push(
    `Vessel position: ${formatCoord(req.from)} (decimal degrees).`,
    `Stay within bounds west ${west}, south ${south}, east ${east}, north ${north}.`,
    `Propulsion: ${config.routeDraftPropulsion}. Cruise speed ${config.routeDraftCruiseSpeedKn} knots.`,
    `Keep about ${config.routeDraftStandoffNm} nautical miles off charted land.`,
    `Add an intermediate turning waypoint on any leg longer than ${config.routeDraftMaxLegNm} nautical miles.`
  )
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
 * Anchor an optimized route's endpoints to the navigator's drawn start and end.
 * The model may nudge the first or last waypoint; the navigator chose where the
 * passage begins and ends, so owned code restores those exact coordinates while
 * keeping the model's names. Mutates the waypoints array in place. Exported for
 * the endpoint trust-boundary tests.
 */
export function anchorRouteEndpoints (
  waypoints: Array<{ latitude: number, longitude: number, name?: string }>,
  seed: Position[]
): void {
  if (waypoints.length === 0 || seed.length === 0) return
  waypoints[0] = { ...waypoints[0], ...seed[0] }
  const lastIndex = waypoints.length - 1
  waypoints[lastIndex] = { ...waypoints[lastIndex], ...seed[seed.length - 1] }
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
      // No provider require_parameters filter: OpenRouter does not advertise the Anthropic models as
      // supporting strict response_format, so require_parameters returns 404 (no endpoints) and a
      // configured Opus or Claude model silently falls back to Gemini. Without the filter OpenRouter
      // routes to a provider that honors the schema (verified live for Opus and Gemini), and the parser
      // is the backstop if a provider ever ignores it and returns prose.
      temperature: parsed.route !== undefined ? ROUTE_OPTIMIZE_TEMPERATURE : ROUTE_DRAFT_TEMPERATURE,
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
    `route-draft served by ${completion.model}, cost $${completion.usage.cost.toFixed(6)}, ` +
    `cached tokens ${completion.usage.cachedTokens}`
  )

  const route = parseDraftedRoute(completion.text, parsed.bounds)
  if (route === undefined) {
    fail(res, 200, 'no-route', 'The AI could not draft a usable route for that. Try rephrasing, or a shorter passage.')
    return
  }

  // On an optimize, anchor the endpoints to the navigator's drawn start and end so the saved route
  // begins and ends exactly where they intended; this runs before the check so the flags describe the
  // route they will save. v1 leaves withinRequestBounds (in parseDraftedRoute) as the only spatial
  // leash on the interior optimize output; a cross-track leash against the drawn polyline is a possible
  // future tightening.
  if (parsed.route !== undefined) anchorRouteEndpoints(route.waypoints, parsed.route)

  // One logger and one draft figure for both the channel router and the safety check.
  const logger = { debug: (m: string) => { app.debug(m) }, error: (m: string) => { app.error(m) } }
  const draftMeters = resolveDraftMeters(app, config)

  // Replace the model geometry with a deterministic water-following route where ENC or
  // OSM water coverage allows; otherwise keep the drafted or drawn route and note it.
  // The router is skipped when too little request budget remains for it plus the check.
  const channelResult: ChannelRouteResult | { ok: false, reason: 'skipped' } =
    deadlineMs - Date.now() >= ROUTER_MIN_BUDGET_MS
      ? await routeChannel(
        { client: service.enc, queryChartedAreas, queryWater: service.tileWater.queryTileWater, bands: DEPTH_BANDS, logger },
        {
          from: { latitude: route.waypoints[0].latitude, longitude: route.waypoints[0].longitude },
          to: { latitude: route.waypoints[route.waypoints.length - 1].latitude, longitude: route.waypoints[route.waypoints.length - 1].longitude },
          draftMeters,
          safetyMarginMeters: config.routeDraftSafetyMarginMeters,
          standoffNm: config.routeDraftStandoffNm,
          ...(parsed.route !== undefined
            ? { corridor: parsed.route }
            : { bboxAnchors: route.waypoints.map((wp) => ({ latitude: wp.latitude, longitude: wp.longitude })) }),
          signal: AbortSignal.timeout(Math.max(MS_PER_SECOND, deadlineMs - Date.now())),
          deadlineMs
        }
      )
      : { ok: false, reason: 'skipped' }
  const channel = applyChannelRoute(route.waypoints, channelResult)
  route.waypoints = channel.waypoints

  const positions: Position[] = route.waypoints.map((wp) => ({ latitude: wp.latitude, longitude: wp.longitude }))

  // The deterministic safety check, bounded by the remaining request budget. If
  // it overruns, the route still returns with an honest "not checked" flag, and
  // the abort controller cancels the in-flight ENC queries so the abandoned
  // check leaves no orphaned upstream requests running.
  const checkBudget = deadlineMs - Date.now()
  const checkAbort = new AbortController()
  const check = await withDeadline(
    checkLegs(
      {
        client: service.enc,
        queryChartedAreas,
        overpass: service.overpass,
        emodnet: service.emodnet,
        scanRouteCorridor,
        logger
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
  const flags = mergeChannelNote(check.flags, channel.notes)

  res.json({
    ok: true,
    waypoints: route.waypoints,
    ...(route.destination !== undefined ? { destination: route.destination } : {}),
    ...(route.name !== undefined ? { name: route.name } : {}),
    note: route.note,
    ...(route.confidence !== undefined ? { confidence: route.confidence } : {}),
    ...(fuel !== undefined ? { fuel } : {}),
    ...(flags.length > 0 ? { flags } : {}),
    // The marker Binnacle asserts to confirm this build actually consumed the route field, since a
    // pre-optimize 0.10.0 build would silently draft from scratch and report the same version.
    ...(parsed.route !== undefined ? { optimized: true } : {})
  })
}

/** Flag display order, most safety-critical first. */
const FLAG_RANK: Record<LegFlag['kind'], number> = { land: 0, shallow: 1, hazard: 2, other: 3 }

/** Order flags so the most safety-critical read first: land, shallow, hazard, then other. */
function orderFlags (flags: LegFlag[]): LegFlag[] {
  return [...flags].sort((a, b) => FLAG_RANK[a.kind] - FLAG_RANK[b.kind])
}

/** A drafted waypoint, the shape the response carries (the model's name is kept on a fallback). */
type DraftWaypoint = { latitude: number, longitude: number, name?: string }

/**
 * Apply the channel router's result to the route. On success the model geometry is
 * replaced by the water-following waypoints (A* owns the path, so waypoint names are
 * dropped), with a depth caveat when the path followed an OSM water outline. On any
 * non-success (no coverage, a decline, or a budget skip) the route is kept and the
 * geometry note is attached, so a declined route is never indistinguishable from a
 * routed one. Exported for the endpoint seam tests.
 */
export function applyChannelRoute (
  waypoints: DraftWaypoint[],
  result: ChannelRouteResult | { ok: false, reason: 'skipped' }
): { waypoints: DraftWaypoint[], notes: LegFlag[] } {
  if (result.ok) {
    const replaced = result.waypoints.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
    return { waypoints: replaced, notes: result.usedTileWater ? [CHANNEL_TILE_WATER_CAVEAT] : [] }
  }
  return { waypoints, notes: [{ kind: 'other', message: CHANNEL_NOTE_BY_REASON[result.reason] }] }
}

/** Merge the channel notes onto the safety-check flags and order them. Exported for the seam tests. */
export function mergeChannelNote (checkFlags: LegFlag[], notes: LegFlag[]): LegFlag[] {
  return orderFlags([...checkFlags, ...notes])
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
  getService: () => RouteDraftService | undefined,
  getInitFailed: () => boolean = () => false
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
        if (getInitFailed()) {
          fail(res, 502, 'model-error', 'Route drafting is configured but failed to start. Check the Crow\'s Nest plugin server log for details.')
        } else {
          fail(res, 401, 'unauthorized', 'AI route drafting is not configured. An administrator must enable it and set the OpenRouter key in the Crow\'s Nest plugin.')
        }
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
