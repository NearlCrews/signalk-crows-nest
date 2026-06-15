/**
 * HTTP client for the OpenStreetMap Overpass API.
 *
 * Builds Overpass QL queries, sends them to the configured endpoint list, and
 * normalizes the responses. Concurrency, throttling, retry/backoff,
 * Retry-After honoring, and close() all live in the shared HTTP client (see
 * `../http-client.js`); this module owns only the Overpass-specific endpoints,
 * headers, query building, and response shape.
 *
 * Overpass-specific behavior:
 *  - Every request is a POST whose body is an Overpass QL query.
 *  - A descriptive `User-Agent` header is REQUIRED by the Overpass usage
 *    policy and is sent on every request.
 *  - The client takes an ordered endpoint list (a primary plus any configured
 *    fallback mirrors) and fails over to the next endpoint when one fails, so a
 *    single instance outage does not take the source offline. A single string
 *    is still accepted and behaves as a one-endpoint list.
 *  - A requested bounding box is clamped to a maximum span, so a wide box
 *    cannot build a query that hits the server's runtime limit. Distant
 *    points of interest are picked up on a later, recentered request.
 *
 * Error contract: both query methods REJECT on any HTTP, network, or parsing
 * failure. `getById` resolves with `undefined` for a query that succeeds but
 * matches no element, which is how a deleted OSM element reads.
 */

import { assertResponseOk, createHttpClient, type RateLimitOptions } from '../http-client.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { MS_PER_SECOND } from '../../shared/time.js'
import { normalizeFallbackEndpoints } from '../../shared/overpass-endpoints.js'
import { splitOnFirstSeparator } from '../../shared/namespaced-id.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import type { Bbox, Logger, Position } from '../../shared/types.js'

// No OpenSeaMap consumer inspects the HTTP status of a failed request: a
// not-found element is returned by Overpass as an empty result, not a 404. So
// `HttpError` is intentionally NOT re-exported here. `RateLimitOptions` is
// re-exported because the test suite imports it for fast-retry overrides.
export type { RateLimitOptions } from '../http-client.js'

/** OSM element types the Overpass API addresses. */
export type OsmElementType = 'node' | 'way' | 'relation'

/**
 * One Overpass element, normalized for the OpenSeaMap source. The Overpass
 * wire element carries `lat`/`lon` for a node and a `center` for a way or a
 * relation; both are resolved here into a single `position`.
 */
export interface OverpassElement {
  /** OSM element type. */
  type: OsmElementType
  /** Numeric OSM element id, unique only within its element type. */
  id: number
  /** OSM tags carried on the element; the source renders detail from these. */
  tags: Record<string, string>
  /** Resolved position. */
  position: Position
  /**
   * ISO-8601 UTC timestamp of the element's last OSM edit, as returned when
   * the Overpass query requests `out ... meta;`. Omitted when the upstream
   * response did not carry it.
   */
  timestamp?: string
}

/** Headers sent on every Overpass request. The descriptive `User-Agent`
 * (sourced from {@link PLUGIN_USER_AGENT}) is required by the Overpass API
 * usage policy.
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': PLUGIN_USER_AGENT,
  'Content-Type': 'text/plain',
  Accept: 'application/json'
}

/** Server-side runtime budget, in seconds, for a bounding-box list query. */
const LIST_QUERY_TIMEOUT_SECONDS = 60

/** Server-side runtime budget, in seconds, for a single-element detail query. */
const DETAIL_QUERY_TIMEOUT_SECONDS = 25

/**
 * Per-request HTTP timeout, in milliseconds. It sits above the server-side
 * query budget so the client waits for a slow-but-progressing query rather
 * than aborting it.
 */
const REQUEST_TIMEOUT_MS = 70 * MS_PER_SECOND

/**
 * Maximum span, in degrees, of either edge of a queried bounding box. A wider
 * box is clamped around its center: a single Overpass query stays small enough
 * to finish inside its runtime budget, and distant points of interest are
 * picked up on a later request once the vessel has moved. Exported so the
 * coastline helper tiles a wide box to exactly this span, defeating the clamp
 * rather than silently truncating coverage.
 */
export const MAX_BBOX_SPAN_DEGREES = 2

/**
 * Rate-limiting defaults. The public Overpass endpoints publish a strict usage
 * policy, so the client stays a conservative citizen: a low concurrency cap, a
 * one-second steady-state spacing, and exponential backoff with full jitter.
 */
const DEFAULTS: RateLimitOptions = {
  maxConcurrency: 2,
  minDelayMs: 1000,
  backoffBaseMs: 2000,
  maxBackoffMs: 60000,
  maxRetries: 3,
  // 5 min ceiling on a server-supplied Retry-After: Overpass legitimately
  // sends 60-120 s cooldowns, so the ceiling has to be larger than
  // maxBackoffMs to avoid truncating into another instant 429.
  maxRetryAfterMs: 300_000
}

/** One coastline way (a `natural=coastline` line) as an ordered vertex list. */
export interface CoastlineWay {
  /** Ordered [lon, lat] vertices of one coastline way. */
  points: number[][]
}

/** Whether an OSM area element is navigable water or a land blocker, from its tags. */
export type OsmAreaKind = 'water' | 'land'

/** One OSM way for the water-and-land area query: its kind and ordered [lon, lat] vertices. */
export interface OsmAreaWay {
  element: 'way'
  kind: OsmAreaKind
  id: number
  points: number[][]
}

/** One OSM relation for the water-and-land area query: its kind and member ways with outer/inner roles. */
export interface OsmAreaRelation {
  element: 'relation'
  kind: OsmAreaKind
  id: number
  members: Array<{ role: 'outer' | 'inner', points: number[][] }>
}

/**
 * A water or land area element, normalized before ring assembly (which lives in the
 * channel-router's osm-water-query, since it needs the route-draft geometry
 * primitives). A standalone way carries its own vertices; a relation carries its
 * member ways' geometry with their outer/inner roles.
 */
export type OsmAreaElement = OsmAreaWay | OsmAreaRelation

/** Public surface of the Overpass client. */
export interface OverpassClient {
  /**
   * List elements within a bounding box whose `seamark:type` tag matches the
   * given alternation regex, plus every `leisure=marina`. Resolves with a
   * normalized array (possibly empty). Rejects on any failure. An optional
   * caller `signal` lets a deadline (the route-draft check) cancel an in-flight
   * request.
   */
  listPointsOfInterest: (bbox: Bbox, seamarkRegex: string, signal?: AbortSignal) => Promise<OverpassElement[]>
  /**
   * Fetch one element by its typed id (`node/123`, `way/456`,
   * `relation/789`). Resolves with the element, or `undefined` when the query
   * succeeds but the element no longer exists. Rejects on any failure. An
   * optional caller `signal` lets a deadline cancel an in-flight request.
   */
  getById: (typedId: string, signal?: AbortSignal) => Promise<OverpassElement | undefined>
  /**
   * List the `natural=coastline` ways within a bounding box as ordered vertex
   * lists, for the route-draft land check. Resolves with an array (possibly
   * empty); ways with fewer than two valid vertices are dropped. Rejects on
   * any failure. An optional caller `signal` lets a deadline cancel an
   * in-flight request.
   */
  listCoastlineWays: (bbox: Bbox, signal?: AbortSignal) => Promise<CoastlineWay[]>
  /**
   * List the OSM water-area polygons (the navigable extent) and land features (island
   * and explicit-land blockers) within a bounding box, for the channel router's
   * worldwide mask. Returns normalized way and relation elements (possibly empty);
   * ring assembly is the caller's job. Rejects on any failure. An optional caller
   * `signal` lets a deadline cancel an in-flight request.
   */
  listWaterAreas: (bbox: Bbox, signal?: AbortSignal) => Promise<OsmAreaElement[]>
  /**
   * Abort any in-flight requests and stop retrying. Call this from
   * plugin.stop so a late response cannot record onto a later run's state.
   */
  close: () => void
}

/**
 * Clamp one bounding-box edge to at most `maxSpan` degrees, keeping its
 * midpoint fixed. A box already within the span is returned unchanged.
 */
function clampSpan (low: number, high: number, maxSpan: number): [number, number] {
  const span = high - low
  if (span <= maxSpan) {
    return [low, high]
  }
  const center = (low + high) / 2
  return [center - maxSpan / 2, center + maxSpan / 2]
}

/** Clamp both edges of a bounding box to {@link MAX_BBOX_SPAN_DEGREES}. */
function clampBbox (bbox: Bbox): Bbox {
  const [south, north] = clampSpan(bbox.south, bbox.north, MAX_BBOX_SPAN_DEGREES)
  const [west, east] = clampSpan(bbox.west, bbox.east, MAX_BBOX_SPAN_DEGREES)
  return { south, north, west, east }
}

/**
 * Build the Overpass QL for a bounding-box list query. The global `[bbox:...]`
 * setting uses the Overpass `south,west,north,east` order, and applies to
 * every statement in the query. `out center tags` returns full tags and, for
 * a way or a relation, a representative center point.
 */
function buildListQuery (bbox: Bbox, seamarkRegex: string): string {
  const { south, west, north, east } = clampBbox(bbox)
  return (
    `[out:json][timeout:${LIST_QUERY_TIMEOUT_SECONDS}][bbox:${south},${west},${north},${east}];` +
    '(' +
    `nwr["seamark:type"~"${seamarkRegex}"];` +
    // OpenStreetMap tags most marinas with `leisure=marina` rather than a
    // `seamark:type`, so they are fetched alongside the seamark features.
    'nwr["leisure"="marina"];' +
    ');' +
    'out center tags meta;'
  )
}

/** Build the Overpass QL for a single-element detail query. */
function buildDetailQuery (type: OsmElementType, id: number): string {
  return (
    `[out:json][timeout:${DETAIL_QUERY_TIMEOUT_SECONDS}];` +
    `${type}(id:${id});` +
    'out center tags meta;'
  )
}

/**
 * Build the Overpass QL for a coastline-way query. `out geom` returns, per way,
 * a `geometry` array of `{ lat, lon }` vertices, which the route-draft land
 * check consumes as polylines. The bbox is clamped to {@link
 * MAX_BBOX_SPAN_DEGREES}, the same clamp the list query applies; the coastline
 * helper tiles a wide box so the clamp never silently truncates coverage.
 */
function buildCoastlineQuery (bbox: Bbox): string {
  const { south, west, north, east } = clampBbox(bbox)
  return (
    `[out:json][timeout:${LIST_QUERY_TIMEOUT_SECONDS}][bbox:${south},${west},${north},${east}];` +
    'way["natural"="coastline"];' +
    'out geom;'
  )
}

/**
 * Server-side runtime budget, in seconds, for the channel router's water-and-land
 * area query. It is short on purpose: the query runs inside the per-request deadline
 * and the caller caps it with its own AbortSignal, so a public Overpass server must
 * give up early rather than spend a minute on a query the client has abandoned.
 */
const WATER_QUERY_TIMEOUT_SECONDS = 8

/**
 * Build the Overpass QL for the channel router's water-and-land area query. It
 * fetches OSM water polygons (the navigable extent: lakes, rivers drawn as areas,
 * lagoons, and large connected systems), excluding the non-navigable `water` values,
 * and OSM land features (`place=island`/`islet` and explicit `natural=land`) as
 * blockers, so an island mapped as its own feature rather than as a hole in the
 * surrounding water body still blocks. `out tags geom;` returns each element's tags
 * (to classify water from land) and, for a relation, its member ways' geometry with
 * their outer/inner roles. The bbox is clamped like the other queries; the water
 * helper tiles a wide box so the clamp never silently truncates coverage. Keep the tag
 * families here in lockstep with {@link osmAreaKind}, which classifies each result.
 */
function buildWaterAreaQuery (bbox: Bbox): string {
  const { south, west, north, east } = clampBbox(bbox)
  return (
    `[out:json][timeout:${WATER_QUERY_TIMEOUT_SECONDS}][bbox:${south},${west},${north},${east}];` +
    '(' +
    'way["natural"="water"]["water"!~"pond|reservoir|basin|wastewater"];' +
    'relation["natural"="water"]["water"!~"pond|reservoir|basin|wastewater"];' +
    'way["waterway"="riverbank"];' +
    'relation["waterway"="riverbank"];' +
    'way["place"~"^(island|islet)$"];' +
    'relation["place"~"^(island|islet)$"];' +
    'way["natural"="land"];' +
    'relation["natural"="land"];' +
    ');' +
    'out tags geom;'
  )
}

/**
 * Parse a typed OSM id (`node/123`) into its element type and numeric id.
 * Throws on a malformed id rather than issuing a guaranteed-empty query.
 */
function parseTypedId (typedId: string): { type: OsmElementType, id: number } {
  const split = splitOnFirstSeparator(typedId, '/')
  const type = split?.prefix ?? ''
  const id = split !== null ? Number(split.remainder) : Number.NaN
  if (
    (type !== 'node' && type !== 'way' && type !== 'relation') ||
    !Number.isInteger(id) || id <= 0
  ) {
    throw new Error(`Invalid OSM element id "${typedId}"`)
  }
  return { type, id }
}

/** A single element as it arrives on the Overpass wire. */
interface OverpassWireElement {
  type?: string
  id?: number
  lat?: number
  lon?: number
  center?: { lat?: number, lon?: number }
  tags?: Record<string, string>
  /** Present only when the query requested `out ... meta;`. */
  timestamp?: string
  /** Per-vertex geometry, present only when the query requested `out geom;`. */
  geometry?: Array<{ lat?: number, lon?: number }>
  /**
   * Relation members with per-member geometry and role, present only for a relation
   * queried with `out geom;`. Only `type === 'way'` members carry ring geometry.
   */
  members?: Array<{ type?: string, role?: string, geometry?: Array<{ lat?: number, lon?: number }> }>
}

/** Response body of an Overpass query. */
interface OverpassResponse {
  elements?: OverpassWireElement[]
}

/**
 * Normalize one wire element, resolving its position from `lat`/`lon` (a node)
 * or `center` (a way or a relation). Returns null for an element missing the
 * fields the source needs, so one bad element cannot fail the whole list.
 */
function parseElement (wire: OverpassWireElement): OverpassElement | null {
  if (wire == null) {
    return null
  }
  const type = wire.type
  if (type !== 'node' && type !== 'way' && type !== 'relation') {
    return null
  }
  if (!Number.isFinite(wire.id)) {
    return null
  }
  const lat = wire.lat ?? wire.center?.lat
  const lon = wire.lon ?? wire.center?.lon
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return null
  }
  const element: OverpassElement = {
    type,
    id: wire.id as number,
    tags: wire.tags ?? {},
    position: { latitude: lat, longitude: lon }
  }
  // Normalize the wire timestamp through Date.toISOString so the published
  // value carries the same canonical precision as every other source
  // (`YYYY-MM-DDTHH:MM:SS.sssZ`). Reject anything Date.parse cannot read,
  // rather than letting it ride through unchecked.
  if (typeof wire.timestamp === 'string' && wire.timestamp.length > 0) {
    const parsed = Date.parse(wire.timestamp)
    if (Number.isFinite(parsed)) {
      element.timestamp = new Date(parsed).toISOString()
    }
  }
  return element
}

/**
 * Parse one `out geom;` way element into a coastline way: the `geometry` array
 * of `{ lat, lon }` vertices becomes ordered `[lon, lat]` points. Drops invalid
 * vertices and returns null for a way left with fewer than two, so a degenerate
 * way cannot pass as a coastline segment.
 */
function parseCoastlineWay (wire: OverpassWireElement): CoastlineWay | null {
  if (wire == null || !Array.isArray(wire.geometry)) {
    return null
  }
  const points: number[][] = []
  for (const vertex of wire.geometry) {
    const lat = vertex?.lat
    const lon = vertex?.lon
    if (isValidLatitude(lat) && isValidLongitude(lon)) {
      points.push([lon, lat])
    }
  }
  if (points.length < 2) {
    return null
  }
  return { points }
}

/** Read a wire geometry array into ordered [lon, lat] points, dropping invalid vertices. */
function geometryPoints (geometry: Array<{ lat?: number, lon?: number }> | undefined): number[][] {
  const points: number[][] = []
  for (const vertex of geometry ?? []) {
    const lat = vertex?.lat
    const lon = vertex?.lon
    if (isValidLatitude(lat) && isValidLongitude(lon)) points.push([lon, lat])
  }
  return points
}

/**
 * Classify an element's tags as a navigable water area, a land blocker, or null
 * (neither). Land tags are checked first so an islet tagged as both never reads as
 * water. The query already narrows to these tags; this re-derives the kind per
 * element since one query returns both. Keep this tag set in lockstep with the tag
 * families in {@link buildWaterAreaQuery}: a tag added there but not here is dropped.
 */
function osmAreaKind (tags: Record<string, string> | undefined): OsmAreaKind | null {
  if (tags === undefined) return null
  if (tags.natural === 'land' || tags.place === 'island' || tags.place === 'islet') return 'land'
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'water'
  return null
}

/**
 * Parse one wire element into an {@link OsmAreaElement}, or null when it is neither a
 * water nor a land feature or carries no usable geometry. A way reads its own
 * `geometry`; a relation reads each WAY member's `geometry` with the member `role`
 * (a missing or blank role defaults to `outer`, per the OSM multipolygon
 * convention). Node and sub-relation members are dropped, since only way members
 * carry ring geometry.
 */
function parseWaterElement (wire: OverpassWireElement): OsmAreaElement | null {
  if (wire == null || !Number.isFinite(wire.id)) return null
  const kind = osmAreaKind(wire.tags)
  if (kind === null) return null
  if (wire.type === 'way') {
    const points = geometryPoints(wire.geometry)
    if (points.length < 2) return null
    return { element: 'way', kind, id: wire.id as number, points }
  }
  if (wire.type === 'relation') {
    const members: OsmAreaRelation['members'] = []
    for (const member of wire.members ?? []) {
      if (member?.type !== 'way') continue
      const points = geometryPoints(member.geometry)
      if (points.length < 2) continue
      members.push({ role: member.role === 'inner' ? 'inner' : 'outer', points })
    }
    if (members.length === 0) return null
    return { element: 'relation', kind, id: wire.id as number, members }
  }
  return null
}

/**
 * Normalize the endpoint argument into a non-empty, ordered, deduped list. A
 * single string becomes a one-element list (the long-standing single-endpoint
 * behavior). The trim, drop-blank, and dedupe pass is shared with the input
 * module via {@link normalizeFallbackEndpoints}; this wrapper adds only the
 * client's own contract: throw when nothing usable remains, since an Overpass
 * client with no endpoint could never query.
 */
function normalizeEndpoints (endpoints: string | readonly string[]): string[] {
  const list = normalizeFallbackEndpoints(typeof endpoints === 'string' ? [endpoints] : endpoints)
  if (list.length === 0) {
    throw new Error('createOverpassClient requires at least one endpoint')
  }
  return list
}

/**
 * Create an Overpass client.
 *
 * @param endpoints The Overpass interpreter URL, or an ordered list of them:
 *                  the primary first, then any fallback mirrors. Each query is
 *                  tried against the endpoints in order until one answers.
 * @param log       Logging surface used for diagnostics.
 * @param options   Optional rate-limit overrides. Mainly used by tests to keep
 *                  them fast; production callers can pass just the endpoints and
 *                  the logger.
 */
export function createOverpassClient (
  endpoints: string | readonly string[],
  log: Logger,
  options: Partial<RateLimitOptions> = {}
): OverpassClient {
  const endpointList = normalizeEndpoints(endpoints)
  const http = createHttpClient(log, {
    label: 'Overpass',
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    defaults: DEFAULTS
  }, options)

  /**
   * Run one raw query attempt against a single endpoint, returning the parsed
   * `{ elements }` response body. Rejects on any HTTP, network, or parsing
   * failure so the caller can fail over to the next endpoint. An optional
   * caller `signal` is threaded to the HTTP client so a deadline can cancel an
   * in-flight request.
   */
  async function attemptRawQuery (
    endpoint: string, query: string, errorPrefix: string, signal?: AbortSignal
  ): Promise<OverpassResponse> {
    const response = await http.fetch(endpoint, {
      method: 'POST',
      headers: BASE_HEADERS,
      body: query,
      signal
    })

    await assertResponseOk(response, errorPrefix)

    const data = await response.json() as OverpassResponse
    if (!Array.isArray(data?.elements)) {
      throw new Error('Overpass response missing the elements array')
    }
    return data
  }

  /**
   * Run an Overpass QL query across the endpoint list, failing over to the next
   * mirror on any failure (a network error after the per-endpoint retries are
   * exhausted, a non-ok HTTP status, or a malformed body), and return the raw
   * `{ elements }` body. The first endpoint that answers wins; when every
   * endpoint fails, the last error is rethrown. This is the single HTTP plumbing
   * path every public method builds on; each parses the elements its own way.
   */
  async function runRawQuery (
    query: string, errorPrefix: string, signal?: AbortSignal
  ): Promise<OverpassResponse> {
    let lastError: unknown
    for (let i = 0; i < endpointList.length; i++) {
      const endpoint = endpointList[i]
      try {
        return await attemptRawQuery(endpoint, query, errorPrefix, signal)
      } catch (error) {
        lastError = error
        if (i < endpointList.length - 1) {
          log.debug(
            `Overpass endpoint ${endpoint} failed (${String(error)}); ` +
            `failing over to ${endpointList[i + 1]}`
          )
        }
      }
    }
    throw lastError
  }

  /**
   * Map a raw response's elements through `parse`, dropping the ones it rejects
   * (returns null) and logging how many were skipped. The shared parse-and-count
   * loop behind both list-shaped methods.
   */
  function collectElements<T> (
    data: OverpassResponse, parse: (wire: OverpassWireElement) => T | null, skipLabel: string
  ): T[] {
    const elements = data.elements ?? []
    const parsed: T[] = []
    for (const wire of elements) {
      const item = parse(wire)
      if (item !== null) {
        parsed.push(item)
      }
    }
    const skipped = elements.length - parsed.length
    if (skipped > 0) {
      log.debug(`Skipped ${skipped} ${skipLabel}`)
    }
    return parsed
  }

  async function listPointsOfInterest (
    bbox: Bbox, seamarkRegex: string, signal?: AbortSignal
  ): Promise<OverpassElement[]> {
    try {
      const data = await runRawQuery(
        buildListQuery(bbox, seamarkRegex),
        'Overpass list request failed',
        signal
      )
      return collectElements(data, parseElement, 'malformed Overpass element(s)')
    } catch (error) {
      log.debug(`Overpass list failed for ${JSON.stringify(bbox)}: ${String(error)}`)
      throw error
    }
  }

  async function getById (
    typedId: string, signal?: AbortSignal
  ): Promise<OverpassElement | undefined> {
    const { type, id } = parseTypedId(typedId)
    try {
      const data = await runRawQuery(
        buildDetailQuery(type, id),
        `Overpass detail request failed for ${typedId}`,
        signal
      )
      // An empty result is the API answering normally: the element has been
      // deleted from OpenStreetMap. The source turns this into a "not found".
      // Take the first element that parses, matching the prior parse-then-pick
      // semantics rather than parsing only the first wire element.
      for (const wire of data.elements ?? []) {
        const element = parseElement(wire)
        if (element !== null) {
          return element
        }
      }
      return undefined
    } catch (error) {
      log.debug(`Overpass detail failed for ${typedId}: ${String(error)}`)
      throw error
    }
  }

  async function listCoastlineWays (
    bbox: Bbox, signal?: AbortSignal
  ): Promise<CoastlineWay[]> {
    try {
      const data = await runRawQuery(
        buildCoastlineQuery(bbox),
        'Overpass coastline request failed',
        signal
      )
      return collectElements(data, parseCoastlineWay, 'coastline way(s) with too few valid vertices')
    } catch (error) {
      log.debug(`Overpass coastline failed for ${JSON.stringify(bbox)}: ${String(error)}`)
      throw error
    }
  }

  async function listWaterAreas (
    bbox: Bbox, signal?: AbortSignal
  ): Promise<OsmAreaElement[]> {
    try {
      const data = await runRawQuery(
        buildWaterAreaQuery(bbox),
        'Overpass water-area request failed',
        signal
      )
      return collectElements(data, parseWaterElement, 'malformed water/land element(s)')
    } catch (error) {
      log.debug(`Overpass water-area failed for ${JSON.stringify(bbox)}: ${String(error)}`)
      throw error
    }
  }

  return {
    listPointsOfInterest,
    getById,
    listCoastlineWays,
    listWaterAreas,
    close: () => { http.close() }
  }
}
