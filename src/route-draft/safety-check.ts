/**
 * The "check these legs" safety check for a drafted route, as an orchestrator
 * over leg-safety providers.
 *
 * Given the draft's ordered TURNING waypoints, the vessel draft, and a safety
 * margin, this returns per-leg flags from the registered providers. In phase 1
 * the only provider is the NOAA ENC check, which reads the charted DEPTH AREA
 * contours, charted LAND AREAS, and charted POINT HAZARDS (wrecks, rocks, and
 * obstructions). The model proposes the waypoints; the providers' owned code
 * disposes the `land`, `shallow`, and `hazard` flags from the charted geometry.
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
 * them without live HTTP. The orchestrator owns the bounded-concurrency leg pool
 * and the not-checked accounting; the per-source query work lives in the
 * providers under `providers/`.
 */

import type { EncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import type { ChartedAreas } from '../inputs/noaa-enc/depth-area-query.js'
import type { ScaleBand } from '../inputs/noaa-enc/enc-direct-types.js'
import type { RouteCorridorScanInput } from '../outputs/route-hazard/route-corridor.js'
import type {
  Bbox,
  CorridorPoi,
  Logger,
  Position
} from '../shared/types.js'
import { createEncProvider } from './providers/enc-provider.js'
import {
  resolveProviders,
  type Dimension,
  type LegRef,
  type LegSafetyProvider
} from './providers/provider.js'

/**
 * How many legs query providers concurrently. Each leg already fans its bands
 * out in parallel, so this is a deliberately small pool: enough to overlap the
 * per-leg round trips and stay inside the request deadline, but not so wide that
 * a long route floods the single shared NOAA ArcGIS endpoint.
 */
const LEG_QUERY_CONCURRENCY = 3

/**
 * The {@link Dimension} values checked per leg, every dimension except the
 * route-wide `hazards` sweep, the ones the orchestrator emits a not-checked note
 * for when no active provider supplies them.
 */
const LEG_DIMENSIONS: readonly Dimension[] = ['depth', 'land']

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
  const { waypoints } = params

  if (waypoints.length < 2) {
    return { flags: [], checked: false }
  }
  // Phase 1 legacy whole-route guard: ENC is the only provider and is US-only,
  // so a single endpoint outside US waters degrades the whole check rather than
  // returning a misleading partial. This dissolves once a global provider lands,
  // since the per-provider coversLeg and the not-checked pass then subsume it.
  if (waypoints.some((wp) => !deps.isInUsWaters(wp))) {
    return {
      flags: [{ kind: 'other', message: 'depth and hazards unavailable: route is outside US ENC coverage' }],
      checked: false
    }
  }

  const enc = createEncProvider({
    client: deps.client,
    queryChartedAreas: deps.queryChartedAreas,
    scanRouteCorridor: deps.scanRouteCorridor,
    logger: deps.logger
  })
  return runOrchestrator([enc], waypoints, params, deps.logger)
}

/** One leg's resolved providers and the flags each one produced. */
interface LegOutcome {
  flags: LegFlag[]
  active: LegSafetyProvider[]
  anyRan: boolean
}

/**
 * Run the provider list over the route: per-leg depth and land checks under a
 * bounded-concurrency pool, then one route-wide hazard sweep per hazard-capable
 * provider over the legs it covers. Returns the flags in leg order and whether
 * any provider's leg query ran.
 */
async function runOrchestrator (
  providers: readonly LegSafetyProvider[],
  waypoints: Position[],
  params: LegCheckParams,
  logger?: Logger
): Promise<LegCheckResult> {
  // Process legs with a small bounded concurrency pool so independent provider
  // queries overlap without flooding the single upstream endpoint, collecting
  // each leg's outcome in leg order for a deterministic result.
  const legCount = waypoints.length - 1
  const outcomes: LegOutcome[] = new Array(legCount)
  let nextLeg = 0
  async function runWorker (): Promise<void> {
    while (nextLeg < legCount) {
      const leg = nextLeg
      nextLeg += 1
      outcomes[leg] = await runLeg(providers, leg, waypoints[leg], waypoints[leg + 1], params, logger)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LEG_QUERY_CONCURRENCY, legCount) }, runWorker)
  )

  const flags: LegFlag[] = []
  let anyLegRan = false
  for (const outcome of outcomes) {
    flags.push(...outcome.flags)
    if (outcome.anyRan) anyLegRan = true
  }

  // For each checkLeg dimension, when no active provider on a leg can supply it,
  // emit one explicit not-checked note for that leg. In phase 1 the ENC provider
  // supplies both depth and land on every leg it covers, so this emits nothing.
  for (let leg = 0; leg < legCount; leg += 1) {
    const outcome = outcomes[leg]
    for (const dimension of LEG_DIMENSIONS) {
      const covered = outcome.active.some((p) => p.capabilities.has(dimension))
      if (!covered) {
        flags.push({ leg, kind: 'other', message: `${dimension} not checked here, no provider covers this leg` })
      }
    }
  }

  // The corridor hazard scan runs once over the route, not per leg, for each
  // hazard-capable provider over the legs it covers. The covered legs are read
  // from each leg's already-resolved active set, the single source of per-leg
  // coverage truth, so coversLeg is not evaluated a second time. In phase 1 the
  // ENC provider sweeps every leg, the same single route-wide hazard scan as
  // before.
  if (anyLegRan) {
    for (const provider of providers) {
      if (provider.checkHazards === undefined || !provider.capabilities.has('hazards')) continue
      // checkHazards stitches its legs into one polyline, so it requires a
      // CONTIGUOUS run (see the precondition on LegSafetyProvider.checkHazards).
      // In phase 1 the ENC provider covers every leg, so this set is always one
      // contiguous run; the union task must split a provider's covered legs into
      // contiguous runs and call checkHazards once per run before a gapped
      // provider can land here.
      const covered: LegRef[] = []
      for (let leg = 0; leg < legCount; leg += 1) {
        if (outcomes[leg].active.includes(provider)) {
          covered.push({ leg, from: waypoints[leg], to: waypoints[leg + 1] })
        }
      }
      if (covered.length === 0) continue
      flags.push(...await provider.checkHazards(covered, params))
    }
  }

  return { flags, checked: anyLegRan }
}

/**
 * Run every active provider for one leg, collecting their depth-and-land flags.
 * A provider that throws degrades to a single `other` note for the leg and is
 * treated as not-run; a provider that succeeds contributes its flags. The active
 * providers run concurrently so their round trips overlap, but each one's flags
 * are gathered into its own slot and merged back in active order, so the flag
 * sequence stays deterministic regardless of completion order.
 */
async function runLeg (
  providers: readonly LegSafetyProvider[],
  leg: number,
  from: Position,
  to: Position,
  params: LegCheckParams,
  logger?: Logger
): Promise<LegOutcome> {
  const active = resolveProviders(providers, from, to)
  const perProvider = await Promise.all(active.map(async (provider) => {
    try {
      const result = await provider.checkLeg(leg, from, to, params)
      // The not-checked pass decides from capabilities, not from this returned
      // coverage, so `result.coverage` is intentionally not read in phase 1. It
      // is the seam a later provider with partial-coverage legs hooks into.
      return { flags: result.flags, ran: true }
    } catch (error) {
      logger?.debug(`leg ${leg} ${provider.id} charted-area query failed: ${String(error)}`)
      return {
        flags: [{ leg, kind: 'other', message: 'depth and hazards not checked for this leg: charted query failed' } as LegFlag],
        ran: false
      }
    }
  }))
  const flags: LegFlag[] = []
  let anyRan = false
  for (const result of perProvider) {
    flags.push(...result.flags)
    if (result.ran) anyRan = true
  }
  return { flags, active, anyRan }
}
