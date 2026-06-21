/**
 * The OpenSeaMap leg-safety provider.
 *
 * This supplies WORLDWIDE point HAZARDS (OpenSeaMap rock, wreck, and obstruction
 * seamarks in the leg corridor) and WORLDWIDE LAND (the OpenStreetMap-derived
 * vector-tile water outline) as a {@link LegSafetyProvider}, so the orchestrator
 * in safety-check.ts can run it alongside the chart-backed providers. The model
 * proposes the waypoints; this owned code disposes the `land` and `hazard` flags.
 *
 * It is GLOBAL: `coversLeg` is always true, since the water-tile and seamark
 * coverage is worldwide. Depth is deliberately NOT a capability: a water outline
 * is a land boundary, not a charted sounding, so this provider never verifies
 * depth, and it does not self-emit a depth-not-checked flag (the orchestrator's
 * capability-keyed not-checked pass owns that for a leg no depth provider covers).
 *
 * Land source: the LAND check reads the same OpenStreetMap-derived vector-tile
 * water layer the channel router routes on, NOT a live Overpass coastline query.
 * The Overpass coastline query returns a 504 on a geographically complex route
 * bbox (a fjord or an archipelago is too heavy for the public servers to return
 * inside the safety check's tight budget), which is exactly the wall that moved
 * the channel router's water source to vector tiles. The tiles are fast, cached
 * across the request (the channel router has usually already warmed them), and
 * never 504, so the land check works worldwide where Overpass timed out. Hazards
 * stay on Overpass, since the tiles carry no point hazards (wrecks, rocks); a
 * failed hazard query degrades honestly to not-checked.
 *
 * The honesty point, encoded in behavior: the water outline is GENERALIZED for
 * display and carries no depth, so the absence of a land flag is NOT proof of
 * clear water, and the message points the navigator at the chart. The land test
 * is point-in-water sampling (robust to the tiles' clip edges at tile
 * boundaries), with a short off-water tolerance so a sub-resolution clip of the
 * generalized outline does not read as a land crossing. The hazard seamark filter
 * is the hard-coded rock/wreck/obstruction alternation, NOT any configured
 * display group, so turning off the OpenSeaMap hazards group on the map never
 * silently drops the safety check.
 *
 * The provider is injectable and mostly pure: `deps` carries the Overpass client
 * (hazards), the tile-water query (land), the corridor scan, and an optional
 * logger, so a test stubs them without live HTTP.
 */

import { combineAbortSignals } from '../../shared/abort.js'
import { tileBbox } from '../../shared/bbox-tiles.js'
import { bboxContainsPoint, boundsOfRings } from '../../geo/position-utilities.js'
import {
  legPolyline,
  pointInRings,
  routeBbox
} from '../leg-geometry.js'
import { toSummary } from '../../inputs/openseamap/element-summary.js'
import { seamarkLabel } from '../../inputs/openseamap/seamark-mapping.js'
import { MAX_BBOX_SPAN_DEGREES, type OverpassClient } from '../../inputs/openseamap/overpass-client.js'
import type { QueryTileWater, TileWater } from '../channel-router/index.js'
import type {
  Bbox,
  Logger,
  Position,
  PoiSummary
} from '../../shared/types.js'
import type { LegFlag, LegCheckParams, ScanRouteCorridor } from '../safety-check.js'
import { corridorHazardFlags, hazardDedupeKey, legsToWaypoints, OPENSEAMAP_PRECEDENCE, OPENSEAMAP_PROVIDER_ID } from './provider.js'
import type {
  Dimension,
  LegRef,
  LegProviderResult,
  LegSafetyProvider
} from './provider.js'

// Re-exported so the safety-check orchestrator and tests reference the land query type through the
// provider that owns the land check, without redefining the channel router's QueryTileWater.
export type { QueryTileWater }

/**
 * The hazard seamark types, hard-coded so a disabled OpenSeaMap display group
 * cannot silently drop the safety check. This is the `seamark:type` alternation
 * the Overpass list query matches against, never the configured display groups.
 */
const HAZARD_SEAMARK_REGEX = '^(rock|wreck|obstruction)$'

/** The dimensions this provider supplies: land and hazards, never depth. */
const OSM_CAPABILITIES: ReadonlySet<Dimension> = new Set<Dimension>(['land', 'hazards'])

/**
 * Per-query timeout for the Overpass seamark hazard query, bounded independently
 * of the whole-request deadline. Overpass latency is slow and wildly variable
 * (well under a second to fifteen-plus seconds for one query), and a single slow
 * query must not consume the whole request budget and time out the entire safety
 * check, dropping the other providers' results with it. When it fires, the hazard
 * contribution degrades honestly to not-checked.
 *
 * Kept short (fast-fail) on purpose: raising it to 12s in testing only added
 * latency without lowering the not-checked rate, because the public Overpass
 * endpoint's reliability, not this cap, drives whether the sweep completes. A
 * snappy response with an honest "point hazards not checked" note beats a slow
 * one when Overpass is having a bad period.
 */
const OSM_QUERY_TIMEOUT_MS = 6000

/**
 * Per-query timeout for the tile-water land fetch. The tiles are fast and usually
 * already cached from the channel router's own fetch, so this is generous headroom
 * rather than a tight bound; on a failure the land check degrades to not-checked.
 */
const TILE_WATER_TIMEOUT_MS = 8000

/** The route-bbox pad for the tile-water fetch, so the outline covers the leg corridor. */
const TILE_WATER_PAD_METERS = 2000

/**
 * The leg sample spacing for the point-in-water land test, in meters. Fine enough
 * to catch a leg cutting a landmass, coarse enough that the per-leg cost over the
 * route's cached water polygons stays small.
 */
const LAND_SAMPLE_SPACING_METERS = 150

/**
 * The off-water run a leg may cover before it is flagged as crossing land, in
 * meters. The water outline is generalized, so a leg hugging a shore can clip a
 * sliver of non-water without genuinely crossing land; only a sustained off-water
 * run (a real landmass) is flagged. A channel-routed leg follows the same tile
 * water, so it stays on water and is never flagged.
 */
const LAND_OFFWATER_TOLERANCE_METERS = 300

/**
 * True when the leg runs over land: sampled along its rhumb line, a point is "on
 * water" when it falls inside any tile water polygon (islands are ring holes, so a
 * point on an island is not on water). Consecutive off-water samples accumulate,
 * and the leg is flagged once that run exceeds the tolerance, so a sub-resolution
 * clip of the generalized outline does not read as a crossing while a real
 * landmass does. Point-in-polygon is robust to the tiles' clip edges at tile
 * boundaries (a water-to-water leg across a tile seam stays inside water), unlike
 * a segment-crossing test.
 */
function legRunsOverLand (
  from: Position,
  to: Position,
  water: TileWater,
  spacingMeters: number,
  toleranceMeters: number
): boolean {
  // Precompute each water polygon's bbox once: the leg is sampled at fine spacing, so a sample outside a
  // polygon's extent can skip the full ring scan rather than walk every polygon's vertices per sample.
  const indexed = water.water.map((w) => ({ rings: w.rings, bbox: boundsOfRings(w.rings) }))
  const onWater = (lon: number, lat: number): boolean =>
    indexed.some((w) => bboxContainsPoint(w.bbox, lon, lat) && pointInRings(lon, lat, w.rings))
  let offRun = 0
  for (const [lon, lat] of legPolyline(from, to, spacingMeters)) {
    if (onWater(lon, lat)) {
      offRun = 0
      continue
    }
    offRun += 1
    if (offRun * spacingMeters > toleranceMeters) return true
  }
  return false
}

/**
 * The result of {@link queryHazards}: the corridor-scan summaries plus a per-id
 * lookup of each hazard's plain-English type word for the flag message.
 */
interface OsmHazardScan {
  summaries: PoiSummary[]
  typeWord: Map<string, string>
}

/**
 * The hazard seamarks over the route bbox, as PoiSummary list entries for the
 * corridor scan plus a per-id lookup of the hazard type word for the flag
 * message. The bbox is tiled into sub-boxes no larger than the client's clamp so
 * a wide route is covered completely rather than silently truncated. Each tile is
 * queried with the hard-coded {@link HAZARD_SEAMARK_REGEX}, never a configured
 * display group, and the deadline signal is threaded through so an abandoned check
 * cancels its in-flight queries. Only Hazard-typed elements survive: the regex
 * narrows the query to hazard seamarks, but {@link toSummary} resolves the PoiType
 * from the full tag set, so a borderline element is filtered here. Rejects on any
 * failure so the caller can emit the degrade note.
 */
async function queryHazards (
  client: OverpassClient,
  bbox: Bbox,
  signal?: AbortSignal
): Promise<OsmHazardScan> {
  const tiles = tileBbox(bbox, MAX_BBOX_SPAN_DEGREES)
  const perTile = await Promise.all(
    tiles.map((tile) => client.listPointsOfInterest(tile, HAZARD_SEAMARK_REGEX, signal))
  )
  const summaries: PoiSummary[] = []
  const typeWord = new Map<string, string>()
  for (const element of perTile.flat()) {
    const summary = toSummary(element)
    if (summary.type !== 'Hazard') continue
    summaries.push(summary)
    // seamarkLabel turns the raw seamark:type ('wreck') into a plain word
    // ('Wreck'); the regex guarantees a hazard seamark tag, so the 'hazard'
    // fallback only guards a malformed element.
    const seamark = element.tags['seamark:type']?.trim().toLowerCase()
    const label = seamark !== undefined ? seamarkLabel(seamark)?.toLowerCase() : undefined
    typeWord.set(summary.id, label ?? 'hazard')
  }
  return { summaries, typeWord }
}

/**
 * Injected collaborators for the OpenSeaMap provider. The scan type is shared
 * with the ENC provider and safety-check.ts so the three cannot drift.
 */
export interface OpenSeaMapProviderDeps {
  /** The Overpass client. Passed through to the hazard seamark query. */
  client: OverpassClient
  /** The tile-water query the worldwide land check reads, the channel router's water source. */
  queryTileWater: QueryTileWater
  /** The route-corridor point-hazard scan. */
  scanRouteCorridor: ScanRouteCorridor
  /** Optional logger for the degrade paths. */
  logger?: Logger
}

/**
 * Build the OpenSeaMap leg-safety provider over the injected Overpass client,
 * tile-water query, corridor scan, and optional logger. The provider supplies the
 * land and hazards dimensions worldwide; depth is never one of them.
 */
export function createOpenSeaMapProvider (deps: OpenSeaMapProviderDeps): LegSafetyProvider {
  // The route's water outline, fetched ONCE for the whole route bbox and shared across every leg's
  // land check, so the cost is one (usually cached) tile-water query for the route rather than one per
  // leg. Memoized on first use within this route; a rejection is shared, so every leg degrades to
  // land-not-checked together, bounded by one timeout.
  let routeWater: Promise<TileWater> | undefined
  const loadRouteWater = (params: LegCheckParams): Promise<TileWater> => {
    if (routeWater === undefined) {
      const bbox = routeBbox(params.waypoints, TILE_WATER_PAD_METERS)
      const signal = combineAbortSignals([params.signal, AbortSignal.timeout(TILE_WATER_TIMEOUT_MS)])
      routeWater = deps.queryTileWater(bbox, signal, deps.logger)
    }
    return routeWater
  }

  return {
    id: OPENSEAMAP_PROVIDER_ID,
    capabilities: OSM_CAPABILITIES,
    precedence: OPENSEAMAP_PRECEDENCE,
    // The OpenStreetMap-derived water tiles and seamark coverage are worldwide, so
    // the provider reaches every leg.
    coversLeg: () => true,
    /**
     * Run one leg's land check against the route's shared water outline (fetched once for the whole
     * route, not per leg), reporting only what this provider verifies: the land flag and the land
     * coverage. Depth is not a capability here, so the orchestrator's capability-keyed not-checked
     * pass owns the depth-not-checked note; this provider does not self-emit one, which would otherwise
     * contradict a depth provider (ENC or EMODnet) that did check the same leg. A rejected or
     * empty-coverage water fetch degrades to a land-not-checked note (with land coverage nodata) rather
     * than throwing, because this provider is global: if it threw, the orchestrator would mark the
     * whole leg not-run even though no depth source covers it here.
     */
    async checkLeg (
      leg: number,
      from: Position,
      to: Position,
      params: LegCheckParams
    ): Promise<LegProviderResult> {
      let water: TileWater
      try {
        water = await loadRouteWater(params)
      } catch (error) {
        deps.logger?.debug(`leg ${leg} tile-water land query failed: ${String(error)}`)
        return {
          flags: [{ leg, kind: 'other', message: 'land not checked for this leg: the water outline query failed' }],
          coverage: { land: 'nodata' }
        }
      }
      if (water.water.length === 0) {
        return {
          flags: [{ leg, kind: 'other', message: 'land not checked for this leg: no mapped water outline covers this area' }],
          coverage: { land: 'nodata' }
        }
      }
      const flags: LegFlag[] = []
      if (legRunsOverLand(from, to, water, LAND_SAMPLE_SPACING_METERS, LAND_OFFWATER_TOLERANCE_METERS)) {
        flags.push({
          leg,
          kind: 'land',
          message:
            'Leaves the OpenStreetMap mapped water outline (likely crosses land), verify on the chart ' +
            '(the outline is generalized, so absence of a flag is not proof of clear water)'
        })
      }
      return { flags, coverage: { land: 'data' } }
    },
    /**
     * Run the corridor hazard scan once over the legs this provider covers and
     * flag each OpenStreetMap-charted point hazard near a leg, mapping the
     * corridor hit to its global leg index. On a hazard query rejection, emit the
     * explicit hazards-not-checked note.
     */
    async checkHazards (legs: LegRef[], params: LegCheckParams): Promise<LegFlag[]> {
      if (legs.length === 0) return []
      const corridorHalfWidthMeters = params.corridorHalfWidthMeters
      // The route polyline for the corridor scan is the covered legs' endpoints,
      // each leg's start followed by the final leg's end. The precondition on
      // checkHazards guarantees this is a contiguous run.
      const waypoints = legsToWaypoints(legs)

      let hazards: OsmHazardScan
      try {
        const signal = combineAbortSignals([params.signal, AbortSignal.timeout(OSM_QUERY_TIMEOUT_MS)])
        hazards = await queryHazards(deps.client, routeBbox(waypoints, corridorHalfWidthMeters), signal)
      } catch (error) {
        deps.logger?.debug(`OpenSeaMap route hazard query failed: ${String(error)}`)
        return [{ kind: 'other', message: 'point hazards not checked: the OpenStreetMap query failed' }]
      }
      if (hazards.summaries.length === 0) return []

      // The shared corridor scan maps each matched POI to a global leg; this provider supplies the OSM
      // wording and the cross-provider dedupe key (seamark type word plus charted position), matching the
      // ENC provider so the same hazard both report collapses to one flag with the ENC reading kept. The
      // orchestrator strips the transient hazardKey before returning.
      return corridorHazardFlags(legs, waypoints, hazards.summaries, deps.scanRouteCorridor, corridorHalfWidthMeters, (poi, globalLeg) => {
        const typeWord = hazards.typeWord.get(poi.id) ?? 'hazard'
        return {
          leg: globalLeg,
          kind: 'hazard',
          message: `OpenStreetMap-charted ${typeWord} within the leg corridor`,
          hazardKey: hazardDedupeKey(typeWord, poi.position)
        }
      })
    }
  }
}
