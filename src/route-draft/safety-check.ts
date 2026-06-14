/**
 * The "check these legs" safety check for a drafted route, as an orchestrator
 * over leg-safety providers.
 *
 * Given the draft's ordered TURNING waypoints, the vessel draft, and a safety
 * margin, this returns per-leg flags from the registered providers. The
 * providers run as a per-leg UNION: the NOAA ENC check (charted DEPTH AREA
 * contours, LAND AREAS, and POINT HAZARDS) over US waters, and the worldwide
 * OpenSeaMap check (OpenStreetMap coastline land and seamark hazards) on every
 * leg. The model proposes the waypoints; the providers' owned code disposes the
 * `land`, `shallow`, and `hazard` flags from the charted geometry.
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
 * charted-area query, the Overpass client, and the corridor scan, so a test
 * stubs them without live HTTP. The orchestrator owns the bounded-concurrency
 * leg pool, the capability-keyed not-checked accounting, the per-provider
 * contiguous-run hazard sweep, and the cross-provider hazard dedupe; the
 * per-source query work lives in the providers under `providers/`. Each provider
 * gates itself geographically (the regions module), so the orchestrator no
 * longer carries a US-waters gate of its own.
 */

import type { EncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import type { ChartedAreas } from '../inputs/noaa-enc/depth-area-query.js'
import type { ScaleBand } from '../inputs/noaa-enc/enc-direct-types.js'
import type { OverpassClient } from '../inputs/openseamap/overpass-client.js'
import type { RouteCorridorScanInput } from '../outputs/route-hazard/route-corridor.js'
import type {
  Bbox,
  CorridorPoi,
  Logger,
  Position
} from '../shared/types.js'
import { capitalizeFirst } from '../shared/strings.js'
import { createEncProvider } from './providers/enc-provider.js'
import { createOpenSeaMapProvider } from './providers/openseamap-provider.js'
import {
  resolveProviders,
  type Dimension,
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
  /**
   * Transient cross-provider dedupe key on a `hazard` flag, set by each provider
   * to `${typeKey}:${lat}:${lon}` so the orchestrator can collapse the same
   * charted hazard reported by ENC and OpenSeaMap into one flag, preferring the
   * ENC reading. The orchestrator strips this field before returning, so it never
   * reaches the response JSON; a degrade note carries no `hazardKey` and is never
   * deduped away.
   */
  hazardKey?: string
}

/** The result of {@link checkLegs}: the flag list plus whether the check ran. */
export interface LegCheckResult {
  /** Every flag raised across the route, in leg order. */
  flags: LegFlag[]
  /**
   * False when no provider's leg query ran on any leg (every provider's query
   * rejected), and the flags carry only the degrade notes. The caller still
   * returns the drafted route, with the notes attached.
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
  /** The Overpass client the worldwide OpenSeaMap provider queries through. */
  overpass: OverpassClient
  /** The route-corridor point-hazard scan. */
  scanRouteCorridor: ScanRouteCorridor
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
 * Returns the flag list and whether the check ran. Each provider gates itself
 * geographically: ENC checks the US legs, OpenSeaMap checks every leg worldwide,
 * and a leg no depth provider covers gets the collapsed depth-not-checked note
 * rather than a false silent pass. The flags never claim a leg is "deep enough";
 * a `shallow` flag states the charted DRVAL1, the MLLW datum, and the band, and
 * the caller's banner carries the area-is-not-every-point caveat.
 */
export async function checkLegs (
  deps: LegCheckDeps,
  params: LegCheckParams
): Promise<LegCheckResult> {
  const { waypoints } = params

  if (waypoints.length < 2) {
    return { flags: [], checked: false }
  }

  // Provider precedence order: ENC first, then the worldwide OpenSeaMap check.
  // Precedence drives the cross-provider hazard dedupe (the ENC reading is kept)
  // and the flag merge order on a leg both providers cover.
  const providers: LegSafetyProvider[] = [
    createEncProvider({
      client: deps.client,
      queryChartedAreas: deps.queryChartedAreas,
      scanRouteCorridor: deps.scanRouteCorridor,
      logger: deps.logger
    }),
    createOpenSeaMapProvider({
      client: deps.overpass,
      scanRouteCorridor: deps.scanRouteCorridor,
      logger: deps.logger
    })
  ]
  return runOrchestrator(providers, waypoints, params, deps.logger)
}

/** One leg's resolved providers and the flags each one produced. */
interface LegOutcome {
  flags: LegFlag[]
  active: LegSafetyProvider[]
  anyRan: boolean
}

/**
 * Run the provider list over the route as a per-leg union: per-leg depth and
 * land checks under a bounded-concurrency pool, the capability-keyed
 * not-checked pass (with the depth note collapsed to one route-level flag),
 * then one contiguous-run hazard sweep per hazard-capable provider over the
 * legs it covers, deduped across providers by charted position and type with
 * the ENC reading preferred. Returns the flags in a deterministic order (leg
 * order for per-leg flags, then the route-level notes) and whether any
 * provider's leg query ran.
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

  // Capability-keyed not-checked pass. For each checkLeg dimension, a dimension
  // no active provider on a leg DECLARES is unowned, and the orchestrator speaks
  // for it. It is keyed off `capabilities`, NOT off a provider's returned
  // coverage: a depth-capable provider (ENC) self-emits its own no-charted-data
  // note, so emitting here on a 'nodata' coverage would double it; coverage is
  // reserved for cross-provider authority, not for not-checked emission. The
  // depth note is collapsed to one route-level flag so a long foreign route does
  // not flood one note per leg. Land is always owned by the global OpenSeaMap
  // provider, so its branch does not fire in practice, but the pass is general
  // over both dimensions.
  for (const dimension of LEG_DIMENSIONS) {
    const unownedLegs: number[] = []
    for (let leg = 0; leg < legCount; leg += 1) {
      if (!outcomes[leg].active.some((p) => p.capabilities.has(dimension))) {
        unownedLegs.push(leg)
      }
    }
    if (unownedLegs.length === 0) continue
    flags.push({
      kind: 'other',
      message:
        `${capitalizeFirst(dimension)} not checked on ${unownedLegs.length} of ${legCount} legs: ` +
        `no ${dimension} source covers that part of the route, verify on the chart.`
    })
  }

  // The corridor hazard scan runs once per CONTIGUOUS run, not per leg, for each
  // hazard-capable provider over the legs it covers. The covered legs are read
  // from each leg's already-resolved active set, the single source of per-leg
  // coverage truth, so coversLeg is not evaluated a second time. checkHazards
  // stitches its legs into one polyline (see the precondition on
  // LegSafetyProvider.checkHazards), so a provider's covered legs are split into
  // maximal runs of consecutive indices and the sweep runs once per run.
  if (anyLegRan) {
    const hazardFlags: LegFlag[] = []
    for (const provider of providers) {
      if (provider.checkHazards === undefined || !provider.capabilities.has('hazards')) continue
      const checkHazards = provider.checkHazards
      const runs = contiguousRuns(legCount, (leg) => outcomes[leg].active.includes(provider))
      const perRun = await Promise.all(
        runs.map((run) =>
          checkHazards(run.map((leg) => ({ leg, from: waypoints[leg], to: waypoints[leg + 1] })), params))
      )
      for (const runFlags of perRun) hazardFlags.push(...runFlags)
    }
    // Cross-provider dedupe: the same charted hazard reported by ENC and
    // OpenSeaMap (same type, same position to four decimals) is kept once, the
    // FIRST in provider-precedence order, which is ENC since it is processed
    // first. A flag with no hazardKey (a `hazard` flag's only carrier, so a
    // kind:'other' degrade note never has one) is never deduped away. The
    // hazardKey is a transient dedupe field, so it is stripped from every
    // returned flag and never reaches the response JSON; the flag's own kind is
    // preserved so a degrade note stays an `other`, not relabelled a hazard.
    const seenHazards = new Set<string>()
    for (const flag of hazardFlags) {
      if (flag.hazardKey !== undefined) {
        if (seenHazards.has(flag.hazardKey)) continue
        seenHazards.add(flag.hazardKey)
      }
      // Strip only the transient hazardKey and keep every other field (kind,
      // message, leg, and any future wp) by construction, so a degrade note
      // stays its own kind and nothing leaks the dedupe key into the response.
      const { hazardKey: _key, ...clean } = flag
      flags.push(clean)
    }
  }

  return { flags, checked: anyLegRan }
}

/**
 * Split the legs a predicate selects into maximal runs of CONSECUTIVE indices,
 * each run a list of global leg indices. A provider covering a gapped subset of
 * legs (US, then foreign, then US) yields one run per US stretch, satisfying the
 * contiguity precondition checkHazards documents: the scan stitches a run into
 * one polyline, so a gap must break it rather than fabricate a segment across the
 * uncovered middle.
 */
function contiguousRuns (legCount: number, covers: (leg: number) => boolean): number[][] {
  const runs: number[][] = []
  let current: number[] | undefined
  for (let leg = 0; leg < legCount; leg += 1) {
    if (covers(leg)) {
      if (current === undefined) {
        current = [leg]
        runs.push(current)
      } else {
        current.push(leg)
      }
    } else {
      current = undefined
    }
  }
  return runs
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
      // coverage, so `result.coverage` is intentionally not read here. It is the
      // seam reserved for cross-provider authority a later task hooks into.
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
