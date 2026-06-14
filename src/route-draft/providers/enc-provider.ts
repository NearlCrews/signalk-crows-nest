/**
 * The NOAA ENC leg-safety provider.
 *
 * This wraps the owned per-leg check against the NOAA ENC charted DEPTH AREA
 * contours, charted LAND AREAS, and charted POINT HAZARDS (wrecks, rocks, and
 * obstructions) as a {@link LegSafetyProvider}, so the orchestrator in
 * safety-check.ts can run it in a provider list. The model proposes the
 * waypoints; this owned code disposes the `land`, `shallow`, and `hazard` flags
 * from the ENC geometry.
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
 * The provider is injectable and mostly pure: `deps` carries the ENC client, the
 * charted-area query, the corridor scan, and an optional logger, so a test stubs
 * them without live HTTP. The only real I/O is the bounded ENC query: ONE
 * `Depth_Area` and `Land_Area` query per leg per band (never one per sample), and
 * one point-hazard query per layer per band for the whole route, deduped on
 * charted position so a hazard charted at several bands is flagged once.
 */

import {
  initialBearingRad,
  projectPointOntoLeg,
  rhumbDistanceMeters
} from '../../geo/position-utilities.js'
import {
  cumulativeLegStartMeters,
  legBbox,
  legForAlongTrack,
  legPolyline,
  pointInRings,
  routeBbox,
  segmentCrossesRings
} from '../leg-geometry.js'
import type { EncDirectClient } from '../../inputs/noaa-enc/enc-direct-client.js'
import type { EncAreaPolygon } from '../../inputs/noaa-enc/depth-area-query.js'
import type { EncFeature, EncLayerKey, ScaleBand } from '../../inputs/noaa-enc/enc-direct-types.js'
import {
  categoryLabel,
  encDepthLabel,
  LAYER_LABEL,
  parseS57Code,
  readNumber
} from '../../inputs/noaa-enc/s57-mapping.js'
import { formatMeters, formatNm } from '../../shared/format-meters.js'
import { METERS_PER_NAUTICAL_MILE, metersFromNauticalMiles } from '../../shared/length.js'
import { isInEncCoverage } from '../../shared/regions.js'
import { SCALE_BAND_LABELS } from '../../shared/scale-band.js'
import type {
  Bbox,
  CorridorPoi,
  Logger,
  Position,
  PoiSummary,
  RoutePolyline
} from '../../shared/types.js'
import type {
  LegFlag,
  LegCheckParams,
  QueryChartedAreas,
  ScanRouteCorridor
} from '../safety-check.js'
import { ENC_PRECEDENCE, hazardDedupeKey } from './provider.js'
import type {
  Dimension,
  LegRef,
  LegProviderResult,
  LegSafetyProvider
} from './provider.js'

// The internal depth sample spacing along a leg, 0.5 nm. Fixed, not user config: the ENC polygon
// resolution at coastal and harbour scale makes finer spacing redundant.
const DEFAULT_SAMPLE_SPACING_METERS = 0.5 * METERS_PER_NAUTICAL_MILE

/** The ENC point-hazard layers the corridor scan reads. */
const HAZARD_LAYERS: readonly EncLayerKey[] = ['wreck', 'obstruction', 'rock']

/**
 * Injected collaborators for the ENC provider. The query and scan types are
 * shared with {@link LegCheckDeps} in safety-check.ts so the two cannot drift.
 */
export interface EncProviderDeps {
  /** The ENC Direct client. Passed through to `queryChartedAreas` and `client.queryLayer`. */
  client: EncDirectClient
  /** The charted depth-area and land-area query (one bounded call per leg per band). */
  queryChartedAreas: QueryChartedAreas
  /** The route-corridor point-hazard scan. */
  scanRouteCorridor: ScanRouteCorridor
  /** Optional logger for the degrade paths. */
  logger?: Logger
}

/** A charted area the leg crosses, tagged with the band it was queried at. */
interface CrossedArea {
  area: EncAreaPolygon
  band: ScaleBand
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
  deps: EncProviderDeps,
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
 * The result of {@link queryHazards}: the corridor-scan summaries plus a per-id
 * lookup of each hazard's layer and raw properties for the flag message.
 */
interface EncHazardScan {
  summaries: PoiSummary[]
  features: Map<string, { layerKey: EncLayerKey, properties: Record<string, unknown> }>
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
  deps: EncProviderDeps,
  bands: ScaleBand[],
  bbox: Bbox,
  signal?: AbortSignal
): Promise<EncHazardScan> {
  const queries: Array<{ layerKey: EncLayerKey, response: { features: EncFeature[] } }> = await Promise.all(
    bands.flatMap((band) => HAZARD_LAYERS.map(async (layerKey) => ({
      layerKey,
      response: await deps.client.queryLayer({ band, layerKey, bbox, signal })
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
  const nearestNm = formatNm(nearest)
  const standoffNm = formatNm(standoffMeters)
  flags.push({
    leg,
    kind: 'other',
    message: `Nearest charted land is ${nearestNm} nm off this leg, under the ${standoffNm} nm standoff`
  })
}

/**
 * Build the ENC leg-safety provider over the injected ENC client, charted-area
 * query, corridor scan, and optional logger. The provider supplies the depth,
 * land, and hazards dimensions over the US ENC coverage envelope.
 */
export function createEncProvider (deps: EncProviderDeps): LegSafetyProvider {
  return {
    id: 'enc',
    capabilities: new Set<Dimension>(['depth', 'land', 'hazards']),
    precedence: ENC_PRECEDENCE,
    coversLeg: (from, to) => isInEncCoverage(from) || isInEncCoverage(to),
    /**
     * Run one leg's charted-depth, land, and standoff check, returning its flags
     * and which dimensions returned data. A rejected ENC query is NOT caught
     * here: it throws so the orchestrator can tell "leg ran" from "leg failed"
     * and emit the degrade note itself.
     */
    async checkLeg (
      leg: number,
      from: Position,
      to: Position,
      params: LegCheckParams
    ): Promise<LegProviderResult> {
      const spacingMeters = params.sampleSpacingMeters ?? DEFAULT_SAMPLE_SPACING_METERS
      const standoffMeters = metersFromNauticalMiles(params.standoffNm)
      const minimalSafetyContourMeters = params.draftMeters + params.safetyMarginMeters
      const flags: LegFlag[] = []
      const bbox = legBbox(from, to, standoffMeters)
      // Let a charted-area query failure throw: the orchestrator distinguishes a
      // leg that ran from one that failed, and emits the degrade note.
      const legBands = await queryLegBands(deps, params.bands, bbox, params.signal)

      const legPath = legPolyline(from, to, spacingMeters)
      const crossedDepth = crossedAreas(legPath, legBands.depth)
      const crossedLand = crossedAreas(legPath, legBands.land)
      const drying = dryingArea(crossedDepth)
      const allLandAreas = legBands.land.flatMap((b) => b.areas)

      addLandFlags(flags, leg, crossedLand, drying)
      addShallowOrNoCoverageFlags(flags, leg, crossedDepth, crossedLand, drying, minimalSafetyContourMeters)
      addStandoffFlag(flags, leg, from, to, allLandAreas, standoffMeters)
      // A successful land query is coverage even with zero land areas. Depth has
      // data when at least one depth area (navigable or drying) crossed the leg.
      return {
        flags,
        coverage: {
          land: 'data',
          depth: crossedDepth.length > 0 ? 'data' : 'nodata'
        }
      }
    },
    /**
     * Run the corridor hazard scan once over the legs this provider covers and
     * flag each point hazard near a leg, mapping the corridor hit to its global
     * leg index. On a hazard query rejection, emit the existing degrade note.
     */
    async checkHazards (legs: LegRef[], params: LegCheckParams): Promise<LegFlag[]> {
      const flags: LegFlag[] = []
      if (legs.length === 0) return flags
      const corridorHalfWidthMeters = params.corridorHalfWidthMeters
      // The route polyline for the corridor scan is the covered legs' endpoints,
      // each leg's start followed by the final leg's end.
      const waypoints: Position[] = [legs[0].from, ...legs.map((ref) => ref.to)]

      let hazards: EncHazardScan
      try {
        hazards = await queryHazards(deps, params.bands, routeBbox(waypoints, corridorHalfWidthMeters), params.signal)
      } catch (error) {
        deps.logger?.debug(`route hazard query failed: ${String(error)}`)
        flags.push({ kind: 'other', message: 'point hazards not checked: charted query failed' })
        return flags
      }
      if (hazards.summaries.length === 0) return flags

      const route: RoutePolyline = {
        routeId: 'route-draft',
        vesselPosition: null,
        waypoints
      }
      const corridorPois: CorridorPoi[] = deps.scanRouteCorridor({
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
        // legForAlongTrack returns the LOCAL index into this covered-leg run;
        // legs[local].leg maps it back to the global route leg index.
        flags.push({
          leg: legs[legForAlongTrack(legStartMeters, poi.alongTrackDistanceMeters)].leg,
          kind: 'hazard',
          message: hazardMessage(feature.layerKey, feature.properties),
          // The shared cross-provider dedupe key, keyed on the layer type and the
          // charted position, so the same hazard the OpenSeaMap provider reports
          // collapses to one flag with the ENC reading kept. The orchestrator
          // strips this transient field before returning.
          hazardKey: hazardDedupeKey(feature.layerKey, poi.position)
        })
      }
      return flags
    }
  }
}
