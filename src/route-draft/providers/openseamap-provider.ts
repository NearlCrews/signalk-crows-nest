/**
 * The OpenSeaMap leg-safety provider.
 *
 * This supplies WORLDWIDE point HAZARDS (OpenSeaMap rock, wreck, and obstruction
 * seamarks in the leg corridor) and WORLDWIDE LAND (OpenStreetMap coastline
 * crossing and standoff) as a {@link LegSafetyProvider}, so the orchestrator in
 * safety-check.ts can run it alongside the chart-backed providers. The model
 * proposes the waypoints; this owned code disposes the `land` and `hazard` flags
 * from the OSM geometry.
 *
 * It is GLOBAL: `coversLeg` is always true, since OpenStreetMap coastline and
 * seamark coverage is worldwide. Depth is deliberately NOT a capability: an OSM
 * coastline is a land boundary, not a charted sounding, so this provider never
 * verifies depth. It does not self-emit a depth-not-checked flag either: the
 * orchestrator's capability-keyed not-checked pass owns that note for a leg no
 * depth provider covers, and a self-emitted note would contradict a depth
 * provider (ENC, EMODnet) that did check the same leg.
 *
 * The honesty point, encoded in behavior: the absence of a coastline crossing is
 * NOT proof of clear water. OSM coastline data is incomplete and a crossing test
 * only catches a leg cutting the digitized shoreline, so the land flag says
 * "verify on the chart". The hazard seamark filter is the hard-coded
 * rock/wreck/obstruction alternation, NOT any configured display group, so
 * turning off the OpenSeaMap hazards group on the map never silently drops the
 * safety check.
 *
 * The provider is injectable and mostly pure: `deps` carries the Overpass
 * client, the corridor scan, and an optional logger, so a test stubs them
 * without live HTTP.
 */

import { metersFromNauticalMiles } from '../../shared/length.js'
import { formatNm } from '../../shared/format-meters.js'
import { tileBbox } from '../../shared/bbox-tiles.js'
import {
  cumulativeLegStartMeters,
  legBbox,
  legForAlongTrack,
  nearestPolylineApproachMeters,
  polylineCrossesLeg,
  routeBbox
} from '../leg-geometry.js'
import { queryCoastline } from '../../inputs/openseamap/coastline-query.js'
import { toSummary } from '../../inputs/openseamap/element-summary.js'
import { seamarkLabel } from '../../inputs/openseamap/seamark-mapping.js'
import { MAX_BBOX_SPAN_DEGREES, type OverpassClient } from '../../inputs/openseamap/overpass-client.js'
import type {
  Bbox,
  CorridorPoi,
  Logger,
  Position,
  PoiSummary,
  RoutePolyline
} from '../../shared/types.js'
import type { LegFlag, LegCheckParams, ScanRouteCorridor } from '../safety-check.js'
import { hazardDedupeKey, OPENSEAMAP_PRECEDENCE } from './provider.js'
import type {
  Dimension,
  LegRef,
  LegProviderResult,
  LegSafetyProvider
} from './provider.js'

/**
 * The hazard seamark types, hard-coded so a disabled OpenSeaMap display group
 * cannot silently drop the safety check. This is the `seamark:type` alternation
 * the Overpass list query matches against, never the configured display groups.
 */
const HAZARD_SEAMARK_REGEX = '^(rock|wreck|obstruction)$'

/** The dimensions this provider supplies: land and hazards, never depth. */
const OSM_CAPABILITIES: ReadonlySet<Dimension> = new Set<Dimension>(['land', 'hazards'])

/**
 * Injected collaborators for the OpenSeaMap provider. The scan type is shared
 * with the ENC provider and safety-check.ts so the three cannot drift.
 */
export interface OpenSeaMapProviderDeps {
  /** The Overpass client. Passed through to `queryCoastline` and the hazard query. */
  client: OverpassClient
  /** The route-corridor point-hazard scan. */
  scanRouteCorridor: ScanRouteCorridor
  /** Optional logger for the degrade paths. */
  logger?: Logger
}

/**
 * The land flags for one leg: a crossing flag, else a standoff flag when the
 * nearest coastline is inside the offing. Both are honest about OSM coverage:
 * the absence of a crossing is not proof of clear water, so the message points
 * the navigator at the chart.
 */
function addLandFlags (
  flags: LegFlag[],
  leg: number,
  from: Position,
  to: Position,
  lines: number[][][],
  standoffMeters: number
): void {
  if (polylineCrossesLeg(from, to, lines)) {
    flags.push({
      leg,
      kind: 'land',
      message: 'Crosses the OpenStreetMap coastline, verify on the chart (absence of a crossing is not proof of clear water)'
    })
    return
  }
  const nearest = nearestPolylineApproachMeters(from, to, lines)
  if (nearest === undefined || nearest >= standoffMeters) return
  const nearestNm = formatNm(nearest)
  const standoffNm = formatNm(standoffMeters)
  flags.push({
    leg,
    kind: 'other',
    message: `Nearest OpenStreetMap coastline is ${nearestNm} nm off this leg, under the ${standoffNm} nm standoff`
  })
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
 * a wide route is covered completely rather than silently truncated, mirroring
 * how queryCoastline tiles. Each tile is queried with the hard-coded
 * {@link HAZARD_SEAMARK_REGEX}, never a configured display group, and the
 * deadline signal is threaded through so an abandoned check cancels its in-flight
 * queries. Only Hazard-typed elements survive: the regex narrows the query to
 * hazard seamarks, but {@link toSummary} resolves the PoiType from the full tag
 * set, so a borderline element is filtered here. Rejects on any failure so the
 * caller can emit the degrade note.
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
 * Build the OpenSeaMap leg-safety provider over the injected Overpass client,
 * corridor scan, and optional logger. The provider supplies the land and hazards
 * dimensions worldwide; depth is never one of them.
 */
export function createOpenSeaMapProvider (deps: OpenSeaMapProviderDeps): LegSafetyProvider {
  return {
    id: 'openseamap',
    capabilities: OSM_CAPABILITIES,
    precedence: OPENSEAMAP_PRECEDENCE,
    // OpenStreetMap coastline and seamark coverage is worldwide, so the provider
    // reaches every leg.
    coversLeg: () => true,
    /**
     * Run one leg's coastline land and standoff check, reporting only what this
     * provider verifies: the land flags and the land coverage. Depth is not a
     * capability here, so the orchestrator's capability-keyed not-checked pass
     * owns the depth-not-checked note for a leg no depth provider covers; this
     * provider does not self-emit one, which would otherwise contradict a depth
     * provider (ENC or EMODnet) that did check the same leg. A rejected coastline
     * query degrades to a land-not-checked note (with land coverage nodata)
     * rather than throwing, because this provider is global: if it threw, the
     * orchestrator would mark the whole leg as not-run even though no depth source
     * ever covers it here.
     */
    async checkLeg (
      leg: number,
      from: Position,
      to: Position,
      params: LegCheckParams
    ): Promise<LegProviderResult> {
      const standoffMeters = metersFromNauticalMiles(params.standoffNm)
      const flags: LegFlag[] = []
      let landCoverage: 'data' | 'nodata' = 'data'
      try {
        const bbox = legBbox(from, to, standoffMeters)
        const ways = await queryCoastline(deps.client, bbox, params.signal)
        const lines = ways.map((way) => way.points)
        addLandFlags(flags, leg, from, to, lines, standoffMeters)
      } catch (error) {
        deps.logger?.debug(`leg ${leg} OpenSeaMap coastline query failed: ${String(error)}`)
        flags.push({
          leg,
          kind: 'other',
          message: 'land not checked for this leg: the OpenStreetMap coastline query failed'
        })
        landCoverage = 'nodata'
      }
      return { flags, coverage: { land: landCoverage } }
    },
    /**
     * Run the corridor hazard scan once over the legs this provider covers and
     * flag each OpenStreetMap-charted point hazard near a leg, mapping the
     * corridor hit to its global leg index. On a hazard query rejection, emit the
     * explicit hazards-not-checked note.
     */
    async checkHazards (legs: LegRef[], params: LegCheckParams): Promise<LegFlag[]> {
      const flags: LegFlag[] = []
      if (legs.length === 0) return flags
      const corridorHalfWidthMeters = params.corridorHalfWidthMeters
      // The route polyline for the corridor scan is the covered legs' endpoints,
      // each leg's start followed by the final leg's end. The precondition on
      // checkHazards guarantees this is a contiguous run.
      const waypoints: Position[] = [legs[0].from, ...legs.map((ref) => ref.to)]

      let hazards: OsmHazardScan
      try {
        hazards = await queryHazards(deps.client, routeBbox(waypoints, corridorHalfWidthMeters), params.signal)
      } catch (error) {
        deps.logger?.debug(`OpenSeaMap route hazard query failed: ${String(error)}`)
        flags.push({ kind: 'other', message: 'point hazards not checked: the OpenStreetMap query failed' })
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
        const typeWord = hazards.typeWord.get(poi.id) ?? 'hazard'
        // legForAlongTrack returns the LOCAL index into this covered-leg run;
        // legs[local].leg maps it back to the global route leg index.
        flags.push({
          leg: legs[legForAlongTrack(legStartMeters, poi.alongTrackDistanceMeters)].leg,
          kind: 'hazard',
          message: `OpenStreetMap-charted ${typeWord} within the leg corridor`,
          // The shared cross-provider dedupe key, keyed on the seamark type word
          // and the charted position, matching the ENC provider so the same
          // hazard both report collapses to one flag (the ENC reading is kept,
          // since ENC has precedence). The orchestrator strips this transient
          // field before returning.
          hazardKey: hazardDedupeKey(typeWord, poi.position)
        })
      }
      return flags
    }
  }
}
