/**
 * The "check these legs" safety check for a drafted route.
 *
 * Given the draft's ordered TURNING waypoints, the vessel draft, and a safety
 * margin, this returns per-leg flags read from the NOAA ENC charted DEPTH AREA
 * contours, charted LAND AREAS, and charted POINT HAZARDS (wrecks, rocks, and
 * obstructions). The model proposes the waypoints; this owned code disposes the
 * `land`, `shallow`, and `hazard` flags from the ENC geometry.
 *
 * The single most important honesty point, encoded in behavior: a charted depth
 * AREA contour is NOT the depth at every point inside it. A `shallow` flag means
 * "the crossed depth area's charted shallow contour (DRVAL1) is X m," never
 * "this leg is deep enough" or "verified." A charted sounding, rock, or
 * obstruction inside an area can be shallower than the area's DRVAL1, and
 * individual soundings (SOUNDG) are not read in v1. The point-hazard scan partly
 * compensates; the caller's banner carries the rest. Every message states the
 * charted value, the MLLW datum, and the usage band, and never a bare verdict.
 *
 * The check is injectable and mostly pure: `deps` carries the ENC client, the
 * charted-area query, the corridor scan, and the US-waters gate, so a test stubs
 * them without live HTTP. The only real I/O is the bounded ENC query: ONE
 * `Depth_Area` and `Land_Area` query per leg per band (never one per sample), and
 * one point-hazard query per layer per band for the whole route, deduped on
 * charted position so a hazard charted at several bands is flagged once.
 */

import {
  distanceMeters,
  initialBearingRad,
  positionToBbox,
  projectPointOntoLeg,
  rhumbDistanceMeters,
  sampleRhumbLeg,
  unionBbox
} from '../geo/position-utilities.js'
import type { EncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import type { ChartedAreas, EncAreaPolygon } from '../inputs/noaa-enc/depth-area-query.js'
import type { EncFeature, EncLayerKey, ScaleBand } from '../inputs/noaa-enc/enc-direct-types.js'
import {
  categoryLabel,
  encDepthLabel,
  LAYER_LABEL,
  parseS57Code,
  readNumber
} from '../inputs/noaa-enc/s57-mapping.js'
import type { RouteCorridorScanInput } from '../outputs/route-hazard/route-corridor.js'
import { formatMeters } from '../shared/format-meters.js'
import { METERS_PER_NAUTICAL_MILE, metersFromNauticalMiles } from '../shared/length.js'
import { SCALE_BAND_LABELS } from '../shared/scale-band.js'
import type {
  Bbox,
  CorridorPoi,
  Logger,
  Position,
  PoiSummary,
  RoutePolyline
} from '../shared/types.js'

// The internal depth sample spacing along a leg, 0.5 nm. Fixed, not user config: the ENC polygon
// resolution at coastal and harbour scale makes finer spacing redundant.
const DEFAULT_SAMPLE_SPACING_METERS = 0.5 * METERS_PER_NAUTICAL_MILE

/** The ENC point-hazard layers the corridor scan reads. */
const HAZARD_LAYERS: readonly EncLayerKey[] = ['wreck', 'obstruction', 'rock']

/**
 * How many legs query the ENC concurrently. Each leg already fans its bands out
 * in parallel, so this is a deliberately small pool: enough to overlap the
 * per-leg round trips and stay inside the request deadline, but not so wide that
 * a long route floods the single shared NOAA ArcGIS endpoint.
 */
const LEG_QUERY_CONCURRENCY = 3

/** A single flag on one leg or waypoint of the drafted route. */
export interface LegFlag {
  /** Index of the leg (consecutive waypoint pair) the flag falls on, when leg-scoped. */
  leg?: number
  /** Index of the waypoint the flag falls on, when waypoint-scoped. */
  wp?: number
  /** The flag category. `other` carries no-coverage, standoff, and degrade notes. */
  kind: 'land' | 'shallow' | 'hazard' | 'other'
  /** Human-readable message. Always states the charted value, never a bare verdict. */
  message: string
}

/** The result of {@link checkLegs}: the flag list plus whether the check ran. */
export interface LegCheckResult {
  /** Every flag raised across the route, in leg order. */
  flags: LegFlag[]
  /**
   * False when the check could not run (outside US waters, or every leg's ENC
   * query rejected) and the flags carry only a single `other` degrade note. The
   * caller still returns the drafted route, with the note attached.
   */
  checked: boolean
}

/**
 * The charted-area query, matching `queryChartedAreas` from depth-area-query.ts.
 * Injected so a test stubs it without an in-process server.
 */
export type QueryChartedAreas = (
  client: EncDirectClient,
  request: { band: ScaleBand, bbox: Bbox, signal?: AbortSignal }
) => Promise<ChartedAreas>

/** The corridor scan, matching `scanRouteCorridor` from route-corridor.ts. */
export type ScanRouteCorridor = (input: RouteCorridorScanInput) => CorridorPoi[]

/** Injected collaborators for {@link checkLegs}. */
export interface LegCheckDeps {
  /** The ENC Direct client. Passed through to `queryChartedAreas` and `client.queryLayer`. */
  client: EncDirectClient
  /** The charted depth-area and land-area query (one bounded call per leg per band). */
  queryChartedAreas: QueryChartedAreas
  /** The route-corridor point-hazard scan. */
  scanRouteCorridor: ScanRouteCorridor
  /** True when a position is inside US waters, the gate ENC coverage needs. */
  isInUsWaters: (position: Position) => boolean
  /** Optional logger for the degrade paths. */
  logger?: Logger
}

/** Parameters describing the route and the vessel's depth tolerance. */
export interface LegCheckParams {
  /** The model's ordered turning waypoints. A check needs at least two. */
  waypoints: Position[]
  /** Vessel draft in meters (SI). */
  draftMeters: number
  /** Safety margin added to draft before the minimal-safety-contour test, in meters. */
  safetyMarginMeters: number
  /** Standoff (offing) under which a leg's nearest land approach is flagged, in nm. */
  standoffNm: number
  /** Internal sample spacing along a leg, in meters. Defaults to 0.5 nm. */
  sampleSpacingMeters?: number
  /** Half-width of the point-hazard corridor either side of a leg, in meters. */
  corridorHalfWidthMeters: number
  /**
   * The usage bands to query, finest first. Best-band selection prefers the
   * first band with coverage and, where bands overlap, the shallower DRVAL1.
   * Defaults to the single configured band the caller passes.
   */
  bands: ScaleBand[]
  /**
   * Optional deadline signal. When it aborts, the in-flight ENC queries cancel
   * rather than running to completion unread, so a check abandoned at the
   * request deadline does not leave orphaned upstream requests behind.
   */
  signal?: AbortSignal
}

/** A charted area the leg crosses, tagged with the band it was queried at. */
interface CrossedArea {
  area: EncAreaPolygon
  band: ScaleBand
}

/**
 * True when `[lon, lat]` lies inside the polygon `rings` (outer ring with holes)
 * by the even-odd ray-cast rule. A point on a hole's interior is outside the
 * polygon. The rings are GeoJSON `[lon, lat]` arrays, the shape EncAreaPolygon
 * carries, so longitude is x and latitude is y. This is a planar test in
 * degree space; at the leg lengths the check works over the error is far below
 * the chart compilation scale, so a spherical correction is not worth its cost.
 */
function pointInRings (lon: number, lat: number, rings: number[][][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      const intersects = (yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (intersects) inside = !inside
    }
  }
  return inside
}

/** Signed area of triangle `a, b, c` (the 2D cross product); its sign gives the turn direction. */
function orient2D (a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/** True when the two planar segments `p1->p2` and `p3->p4` properly cross. */
function segmentsCross (
  p1: number[], p2: number[], p3: number[], p4: number[]
): boolean {
  const d1 = orient2D(p3, p4, p1)
  const d2 = orient2D(p3, p4, p2)
  if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) return false
  const d3 = orient2D(p1, p2, p3)
  const d4 = orient2D(p1, p2, p4)
  return (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)
}

/** True when the segment `[a, b]` (each `[lon, lat]`) crosses any ring edge of the area. */
function segmentCrossesRings (a: number[], b: number[], rings: number[][][]): boolean {
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      if (segmentsCross(a, b, ring[j], ring[i])) return true
    }
  }
  return false
}

/** The ordered `[lon, lat]` points along a leg: the endpoints plus the interior samples. */
function legPolyline (from: Position, to: Position, spacingMeters: number): number[][] {
  const interior = sampleRhumbLeg(from, to, spacingMeters)
  const polyline: number[][] = [[from.longitude, from.latitude]]
  for (const p of interior) polyline.push([p.longitude, p.latitude])
  polyline.push([to.longitude, to.latitude])
  return polyline
}

/**
 * The charted areas (across every band in `bandAreas`) that the leg crosses. An
 * area is crossed when a leg vertex sits inside it or a leg sub-segment cuts one
 * of its ring edges. The segment test is what stops a shoal thinner than the
 * sample spacing from hiding between two samples.
 */
function crossedAreas (
  legPath: number[][],
  bandAreas: Array<{ band: ScaleBand, areas: EncAreaPolygon[] }>
): CrossedArea[] {
  const crossed: CrossedArea[] = []
  for (const { band, areas } of bandAreas) {
    for (const area of areas) {
      if (legCrossesArea(legPath, area.rings)) {
        crossed.push({ area, band })
      }
    }
  }
  return crossed
}

function legCrossesArea (legPath: number[][], rings: number[][][]): boolean {
  // The vertex test runs first because the proper-crossing segment test below
  // does not catch a leg lying exactly collinear with a ring edge; a densified
  // vertex landing inside the ring is the backstop for that degenerate case.
  for (const [lon, lat] of legPath) {
    if (pointInRings(lon, lat, rings)) return true
  }
  for (let i = 0; i + 1 < legPath.length; i += 1) {
    if (segmentCrossesRings(legPath[i], legPath[i + 1], rings)) return true
  }
  return false
}

/**
 * The shallowest navigable (non-drying) DRVAL1 across the crossed depth areas,
 * with the band it came from. A drying area (negative DRVAL1) is excluded here
 * and handled as land. Returns undefined when no crossed depth area carries a
 * navigable DRVAL1, which the caller reads as "no charted depth here."
 *
 * Best-band, conservative: we do NOT trust the finest band alone. Where bands
 * overlap, a coarse band's generalized contour can read deeper than the finer
 * survey, so the SHALLOWEST DRVAL1 across every covering band is the reading
 * that does not over-promise depth.
 */
function shallowestNavigable (
  crossed: CrossedArea[]
): { drval1: number, band: ScaleBand } | undefined {
  let best: { drval1: number, band: ScaleBand } | undefined
  for (const { area, band } of crossed) {
    const drval1 = area.depthRange?.shallowMeters
    if (drval1 === undefined || drval1 < 0) continue
    if (best === undefined || drval1 < best.drval1) {
      best = { drval1, band }
    }
  }
  return best
}

/** A crossed area charted as drying, with the height it dries to above datum. */
interface DryingArea {
  driesToMeters: number
  band: ScaleBand
}

/** A crossed drying area (negative DRVAL1), the shallowest drying height first. */
function dryingArea (crossed: CrossedArea[]): DryingArea | undefined {
  let found: DryingArea | undefined
  for (const { area, band } of crossed) {
    const drval1 = area.depthRange?.shallowMeters
    if (drval1 === undefined || drval1 >= 0) continue
    // A negative DRVAL1 is a drying HEIGHT above datum: -1.6 dries to 1.6 m
    // above MLLW. The deepest-drying (most negative) area is the most relevant.
    const driesToMeters = -drval1
    if (found === undefined || driesToMeters > found.driesToMeters) {
      found = { driesToMeters, band }
    }
  }
  return found
}

/** Build the per-band charted areas for one leg, dropping bands that have no coverage. */
async function queryLegBands (
  deps: LegCheckDeps,
  bands: ScaleBand[],
  bbox: Bbox,
  signal?: AbortSignal
): Promise<{
  depth: Array<{ band: ScaleBand, areas: EncAreaPolygon[] }>
  land: Array<{ band: ScaleBand, areas: EncAreaPolygon[] }>
}> {
  const depth: Array<{ band: ScaleBand, areas: EncAreaPolygon[] }> = []
  const land: Array<{ band: ScaleBand, areas: EncAreaPolygon[] }> = []
  // One bounded query per band per leg, the bands issued concurrently rather
  // than awaited one after another. queryChartedAreas issues the Depth_Area and
  // Land_Area requests together, so this is one charted-area call per band.
  // Promise.all preserves input order, so the result stays finest-band-first.
  const perBand = await Promise.all(
    bands.map(async (band) => ({ band, areas: await deps.queryChartedAreas(deps.client, { band, bbox, signal }) }))
  )
  for (const { band, areas } of perBand) {
    depth.push({ band, areas: areas.depthAreas })
    land.push({ band, areas: areas.landAreas })
  }
  return { depth, land }
}

/** The leg's bounding box, expanded by the standoff so a near-miss land area is in range. */
function legBbox (from: Position, to: Position, standoffMeters: number): Bbox {
  // positionToBbox encloses a circle of the given radius around a point; the
  // union of the two endpoint boxes covers the whole leg plus the standoff
  // margin either side, which is the area the land-proximity test reads.
  return unionBbox(
    positionToBbox(from, standoffMeters),
    positionToBbox(to, standoffMeters)
  )
}

/** Nearest approach, in meters, from any land-area ring vertex to the leg. */
function nearestLandApproachMeters (
  from: Position,
  to: Position,
  landAreas: EncAreaPolygon[]
): number | undefined {
  const bearing = initialBearingRad(from, to)
  const legLengthMeters = rhumbDistanceMeters(from, to)
  let nearest: number | undefined
  for (const area of landAreas) {
    for (const ring of area.rings) {
      for (const [lon, lat] of ring) {
        const point: Position = { latitude: lat, longitude: lon }
        const projection = projectPointOntoLeg(from, to, point, bearing)
        const along = projection.alongTrackMeters
        const cross = Math.abs(projection.crossTrackMeters)
        if (!Number.isFinite(along) || !Number.isFinite(cross)) continue
        // Off the ends of the leg the perpendicular distance is not the real
        // separation, so only the on-leg span contributes a standoff reading.
        // The bound uses the rhumb leg length while projectPointOntoLeg measures
        // great-circle along-track; for the short coastal legs this targets the two
        // are close and the rhumb length is not the shorter, so a near-end land
        // vertex is not wrongly dropped.
        if (along < 0 || along > legLengthMeters) continue
        if (nearest === undefined || cross < nearest) nearest = cross
      }
    }
  }
  return nearest
}

/**
 * Map an ENC point-hazard feature to a `PoiSummary` for the corridor scan, or
 * null when it carries no usable geometry. Only the fields the scan and the flag
 * message read are filled; the rest are stub values, since this summary never
 * leaves the check.
 */
function hazardSummary (layerKey: EncLayerKey, feature: EncFeature): PoiSummary | null {
  if (feature.geometry.type !== 'Point') return null
  const [lon, lat] = feature.geometry.coordinates
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const objectId = typeof feature.id === 'number'
    ? feature.id
    : (typeof feature.properties.OBJECTID === 'number' ? feature.properties.OBJECTID : undefined)
  if (objectId === undefined) return null
  const name = categoryLabel(layerKey, feature.properties) ?? LAYER_LABEL[layerKey]
  return {
    id: `${layerKey}_${objectId}`,
    type: 'Hazard',
    position: { latitude: lat, longitude: lon },
    name,
    source: 'noaa-enc',
    url: '',
    attribution: '',
    skIcon: 'hazard'
  }
}

/** The hazard message: feature type (category if known, else layer label), and any charted least-depth value. */
function hazardMessage (
  layerKey: EncLayerKey,
  properties: Record<string, unknown>
): string {
  const category = categoryLabel(layerKey, properties)
  const featureType = category ?? LAYER_LABEL[layerKey].toLowerCase()
  const parts: string[] = [featureType]
  const valsou = readNumber(properties.VALSOU)
  if (valsou !== undefined) {
    const label = encDepthLabel(parseS57Code(properties.QUASOU)).toLowerCase()
    parts.push(`${label} ${formatMeters(valsou)} m`)
  }
  return `Charted ${parts.join(', ')} within the leg corridor`
}

/**
 * Query the three point-hazard layers across every band over the route bbox,
 * mapped to PoiSummary. The same charted hazard appears in several scale bands
 * with distinct OBJECTIDs but the same position, so results are deduped on layer
 * plus charted position (rounded to about a meter), keeping the finest band's
 * feature. Querying every band, not just the finest, means a hazard charted only
 * at a coarser band is still flagged, matching the depth check's band sweep. The
 * layer queries fire concurrently; Promise.all preserves order, so the dedupe
 * keeps the finest-band-first feature deterministically.
 */
async function queryHazards (
  deps: LegCheckDeps,
  bands: ScaleBand[],
  routeBbox: Bbox,
  signal?: AbortSignal
): Promise<{ summaries: PoiSummary[], features: Map<string, { layerKey: EncLayerKey, properties: Record<string, unknown> }> }> {
  const queries: Array<{ layerKey: EncLayerKey, response: { features: EncFeature[] } }> = await Promise.all(
    bands.flatMap((band) => HAZARD_LAYERS.map(async (layerKey) => ({
      layerKey,
      response: await deps.client.queryLayer({ band, layerKey, bbox: routeBbox, signal })
    })))
  )
  const summaries: PoiSummary[] = []
  const features = new Map<string, { layerKey: EncLayerKey, properties: Record<string, unknown> }>()
  const seen = new Set<string>()
  for (const { layerKey, response } of queries) {
    for (const feature of response.features) {
      const summary = hazardSummary(layerKey, feature)
      if (summary === null) continue
      const dedupeKey = `${layerKey}:${summary.position.latitude.toFixed(6)}:${summary.position.longitude.toFixed(6)}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      summaries.push(summary)
      features.set(summary.id, { layerKey, properties: feature.properties })
    }
  }
  return { summaries, features }
}

/**
 * Run the per-leg charted-depth, land, standoff, and point-hazard check.
 *
 * Returns the flag list and whether the check ran. Outside US waters, or when a
 * leg's ENC query rejects, the leg degrades to a single `other` note rather than
 * a false silent pass. The flags never claim a leg is "deep enough"; a `shallow`
 * flag states the charted DRVAL1, the MLLW datum, and the band, and the caller's
 * banner carries the area-is-not-every-point caveat.
 */
export async function checkLegs (
  deps: LegCheckDeps,
  params: LegCheckParams
): Promise<LegCheckResult> {
  const {
    waypoints,
    draftMeters,
    safetyMarginMeters,
    standoffNm,
    corridorHalfWidthMeters,
    bands
  } = params
  const spacingMeters = params.sampleSpacingMeters ?? DEFAULT_SAMPLE_SPACING_METERS

  if (waypoints.length < 2) {
    return { flags: [], checked: false }
  }
  // ENC coverage is US-only. A single endpoint outside US waters degrades the
  // whole check rather than returning a misleading partial.
  if (waypoints.some((wp) => !deps.isInUsWaters(wp))) {
    return {
      flags: [{ kind: 'other', message: 'depth and hazards unavailable: route is outside US ENC coverage' }],
      checked: false
    }
  }

  const context: LegContext = {
    deps,
    bands,
    spacingMeters,
    standoffMeters: metersFromNauticalMiles(standoffNm),
    minimalSafetyContourMeters: draftMeters + safetyMarginMeters,
    signal: params.signal
  }

  // Process legs with a small bounded concurrency pool so independent ENC
  // queries overlap without flooding the single upstream endpoint, collecting
  // each leg's flags in leg order for a deterministic result.
  const legCount = waypoints.length - 1
  const perLeg: Array<{ flags: LegFlag[], checked: boolean }> = new Array(legCount)
  let nextLeg = 0
  async function runWorker (): Promise<void> {
    while (nextLeg < legCount) {
      const leg = nextLeg
      nextLeg += 1
      perLeg[leg] = await checkOneLeg(context, leg, waypoints[leg], waypoints[leg + 1])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LEG_QUERY_CONCURRENCY, legCount) }, runWorker)
  )

  const flags: LegFlag[] = []
  let anyLegChecked = false
  for (const result of perLeg) {
    flags.push(...result.flags)
    if (result.checked) anyLegChecked = true
  }

  // The corridor hazard scan runs once over the whole route, not per leg, across
  // the same bands the depth check sweeps so a hazard charted only at a coarser
  // band is not missed.
  if (anyLegChecked) {
    await addHazardFlags(deps, flags, waypoints, bands, corridorHalfWidthMeters, params.signal)
  }

  return { flags, checked: anyLegChecked }
}

/** The per-leg inputs shared across the bounded-concurrency leg workers. */
interface LegContext {
  deps: LegCheckDeps
  bands: ScaleBand[]
  spacingMeters: number
  standoffMeters: number
  minimalSafetyContourMeters: number
  signal?: AbortSignal
}

/**
 * Run one leg's charted-depth, land, and standoff check, returning its flags
 * and whether it was checked. A rejected ENC query degrades to a single `other`
 * note, never a silent pass.
 */
async function checkOneLeg (
  ctx: LegContext,
  leg: number,
  from: Position,
  to: Position
): Promise<{ flags: LegFlag[], checked: boolean }> {
  const flags: LegFlag[] = []
  const bbox = legBbox(from, to, ctx.standoffMeters)
  let legBands: Awaited<ReturnType<typeof queryLegBands>>
  try {
    legBands = await queryLegBands(ctx.deps, ctx.bands, bbox, ctx.signal)
  } catch (error) {
    ctx.deps.logger?.debug(`leg ${leg} charted-area query failed: ${String(error)}`)
    flags.push({ leg, kind: 'other', message: 'depth and hazards not checked for this leg: charted query failed' })
    return { flags, checked: false }
  }

  const legPath = legPolyline(from, to, ctx.spacingMeters)
  const crossedDepth = crossedAreas(legPath, legBands.depth)
  const crossedLand = crossedAreas(legPath, legBands.land)
  const drying = dryingArea(crossedDepth)
  const allLandAreas = legBands.land.flatMap((b) => b.areas)

  addLandFlags(flags, leg, crossedLand, drying)
  addShallowOrNoCoverageFlags(flags, leg, crossedDepth, crossedLand, drying, ctx.minimalSafetyContourMeters)
  addStandoffFlag(flags, leg, from, to, allLandAreas, ctx.standoffMeters)
  return { flags, checked: true }
}

/** Land flag for a crossed Land_Area, and for a crossed drying depth area. */
function addLandFlags (
  flags: LegFlag[],
  leg: number,
  crossedLand: CrossedArea[],
  drying: DryingArea | undefined
): void {
  if (crossedLand.length > 0) {
    const band = crossedLand[0].band
    flags.push({
      leg,
      kind: 'land',
      message: `Crosses charted land (${SCALE_BAND_LABELS[band]} band)`
    })
  }
  if (drying !== undefined) {
    // A negative DRVAL1 is a drying height, NOT a water depth. Never print a
    // negative depth; classify it as land with the drying height above MLLW.
    flags.push({
      leg,
      kind: 'land',
      message: `Crosses an area charted as drying (dries to ${formatMeters(drying.driesToMeters)} m above MLLW, ${SCALE_BAND_LABELS[drying.band]} band)`
    })
  }
}

/**
 * The shallow flag (DRVAL1 under the minimal safety contour) or, when the leg
 * crosses neither a navigable depth area nor any land area, the explicit
 * no-coverage flag. No-coverage is a flag, never a silent pass.
 */
function addShallowOrNoCoverageFlags (
  flags: LegFlag[],
  leg: number,
  crossedDepth: CrossedArea[],
  crossedLand: CrossedArea[],
  drying: DryingArea | undefined,
  minimalSafetyContourMeters: number
): void {
  const shallowest = shallowestNavigable(crossedDepth)
  if (shallowest !== undefined) {
    if (shallowest.drval1 < minimalSafetyContourMeters) {
      // State the charted contour value, never "deep enough" or "verified": the
      // area's DRVAL1 is not the depth at every point inside it. encDepthLabel
      // carries the MLLW datum tag this check shares with the sounding labels.
      flags.push({
        leg,
        kind: 'shallow',
        message: `Charted depth area DRVAL1 is ${formatMeters(shallowest.drval1)} m, ${encDepthLabel(undefined)}, ${SCALE_BAND_LABELS[shallowest.band]} band, under the ${formatMeters(minimalSafetyContourMeters)} m draft-plus-margin contour`
      })
    }
    return
  }
  // No navigable depth area covers the leg. If a land area does, the land flag
  // already speaks for it; otherwise the leg crosses an uncharted gap.
  if (crossedLand.length === 0 && drying === undefined) {
    flags.push({
      leg,
      kind: 'other',
      message: 'no charted depth area here, verify on the chart'
    })
  }
}

/** Standoff flag when the leg's nearest land approach is under the configured offing. */
function addStandoffFlag (
  flags: LegFlag[],
  leg: number,
  from: Position,
  to: Position,
  landAreas: EncAreaPolygon[],
  standoffMeters: number
): void {
  if (landAreas.length === 0) return
  const nearest = nearestLandApproachMeters(from, to, landAreas)
  if (nearest === undefined || nearest >= standoffMeters) return
  const nearestNm = (nearest / METERS_PER_NAUTICAL_MILE).toFixed(2)
  const standoffNm = (standoffMeters / METERS_PER_NAUTICAL_MILE).toFixed(2)
  flags.push({
    leg,
    kind: 'other',
    message: `Nearest charted land is ${nearestNm} nm off this leg, under the ${standoffNm} nm standoff`
  })
}

/** Run the corridor hazard scan once over the route and flag each point hazard near a leg. */
async function addHazardFlags (
  deps: LegCheckDeps,
  flags: LegFlag[],
  waypoints: Position[],
  bands: ScaleBand[],
  corridorHalfWidthMeters: number,
  signal?: AbortSignal
): Promise<void> {
  let routeBbox = positionToBbox(waypoints[0], corridorHalfWidthMeters)
  for (let i = 1; i < waypoints.length; i += 1) {
    routeBbox = unionBbox(routeBbox, positionToBbox(waypoints[i], corridorHalfWidthMeters))
  }
  let hazards: Awaited<ReturnType<typeof queryHazards>>
  try {
    hazards = await queryHazards(deps, bands, routeBbox, signal)
  } catch (error) {
    deps.logger?.debug(`route hazard query failed: ${String(error)}`)
    flags.push({ kind: 'other', message: 'point hazards not checked: charted query failed' })
    return
  }
  if (hazards.summaries.length === 0) return

  const route: RoutePolyline = {
    routeId: 'route-draft',
    vesselPosition: null,
    waypoints
  }
  const corridorPois = deps.scanRouteCorridor({
    route,
    pois: hazards.summaries,
    corridorHalfWidthMeters
  })
  // Built once: the cumulative great-circle distance to each leg's start, the
  // same measure scanRouteCorridor uses for alongTrackDistanceMeters, so a
  // hazard maps to the right leg and the leg lengths are not re-summed per POI.
  const legStartMeters = cumulativeLegStartMeters(waypoints)
  for (const poi of corridorPois) {
    const feature = hazards.features.get(poi.id)
    if (feature === undefined) continue
    flags.push({
      leg: legForAlongTrack(legStartMeters, poi.alongTrackDistanceMeters),
      kind: 'hazard',
      message: hazardMessage(feature.layerKey, feature.properties)
    })
  }
}

/**
 * The cumulative great-circle distance to each leg's start, one entry per leg
 * (index i is the distance from the route start to waypoint i). Great-circle,
 * not rhumb, so it matches the along-track distance scanRouteCorridor reports.
 */
function cumulativeLegStartMeters (waypoints: Position[]): number[] {
  const starts: number[] = []
  let accumulated = 0
  for (let leg = 0; leg + 1 < waypoints.length; leg += 1) {
    starts.push(accumulated)
    accumulated += distanceMeters(waypoints[leg], waypoints[leg + 1])
  }
  return starts
}

/**
 * The leg index a corridor hazard falls on, from its along-track distance and
 * the prebuilt cumulative leg-start distances. A point on a leg boundary is
 * attributed to the earlier leg, matching the original accumulation.
 */
function legForAlongTrack (legStartMeters: number[], alongTrackMeters: number): number {
  for (let leg = 0; leg + 1 < legStartMeters.length; leg += 1) {
    if (alongTrackMeters <= legStartMeters[leg + 1]) return leg
  }
  return legStartMeters.length - 1
}
