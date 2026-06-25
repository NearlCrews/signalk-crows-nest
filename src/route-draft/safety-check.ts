/**
 * The "check these legs" safety check for a drafted route, as an orchestrator
 * over leg-safety providers.
 *
 * Given the draft's ordered TURNING waypoints, the vessel draft, and a safety
 * margin, this returns per-leg flags from the registered providers. The
 * providers run as a per-leg UNION: the NOAA ENC check (charted DEPTH AREA
 * contours, LAND AREAS, and POINT HAZARDS) over US waters, the EMODnet check
 * (European MODELED bathymetry depth) over the European seas, and the worldwide
 * OpenSeaMap check (OpenStreetMap-derived vector-tile water outline for land, and
 * OpenStreetMap seamark point hazards) on every leg. The model proposes the
 * waypoints; the providers' owned code disposes the `land`, `shallow`, and
 * `hazard` flags from the charted geometry.
 *
 * Depth authority follows precedence: on a leg where more than one depth provider
 * covers it, the highest-precedence one that returned data owns depth (ENC's
 * charted MLLW reading over EMODnet's modeled LAT reading), so a lower provider's
 * depth flags are dropped there. With today's disjoint US and European envelopes
 * no single leg has both depth providers active, so the rule is a no-op in
 * production, but it is the rule the precedence field exists for.
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
 * charted-area query, the Overpass client, the tile-water query, the EMODnet
 * client, and the corridor scan, so a test stubs them without live HTTP. The
 * orchestrator owns the
 * bounded-concurrency leg pool, the per-leg depth-authority pass, the
 * capability-keyed not-checked accounting, the per-provider contiguous-run hazard
 * sweep, and the cross-provider hazard dedupe; the per-source query work lives in
 * the providers under `providers/`. Each provider gates itself geographically
 * (the regions module), so the orchestrator no longer carries a US-waters gate of
 * its own.
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
import { mapWithConcurrency } from '../shared/concurrency.js'
import type { EmodnetClient } from './emodnet/emodnet-client.js'
import { createEmodnetProvider } from './providers/emodnet-provider.js'
import { createEncProvider } from './providers/enc-provider.js'
import { createOpenSeaMapProvider, type QueryTileWater } from './providers/openseamap-provider.js'
import {
  EMODNET_PROVIDER_ID,
  resolveProviders,
  type Dimension,
  type LegDimensionCoverage,
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

/**
 * The flag kinds a depth check verdicts on: a `shallow` reading, and a `land`
 * flag derived from a drying or above-datum depth reading (both ENC and EMODnet
 * classify a drying area as land off the depth value, see their drying-as-land
 * rule). The depth-authority pass drops these from a superseded depth provider so
 * its reading cannot contradict the higher source's, regardless of how many
 * dimensions the superseded provider declares.
 *
 * Including 'land' is sound only while every superseded depth provider emits land
 * solely as drying-or-above-datum (EMODnet does). A `land` flag can also be a
 * genuine land-area or coastline crossing, which is NOT depth-derived, so a future
 * depth-capable provider that also emits genuine land crossings must distinguish
 * drying-as-land from coastline land before relying on this set.
 */
const DEPTH_VERDICT_KINDS: ReadonlySet<LegFlag['kind']> = new Set<LegFlag['kind']>(['shallow', 'land'])

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
  /** The charted depth-area and land-area query (one bounded call per band, route-wide, shared across legs). */
  queryChartedAreas: QueryChartedAreas
  /** The Overpass client the worldwide OpenSeaMap provider queries through for point hazards. */
  overpass: OverpassClient
  /** The tile-water query the worldwide OpenSeaMap provider reads for its land check. */
  queryTileWater: QueryTileWater
  /** The EMODnet depth-profile client the European modeled-depth provider queries through. */
  emodnet: EmodnetClient
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

  // Build every provider, then sort by the explicit precedence field (lower is
  // higher authority), so the merge order, the cross-provider hazard dedupe, and
  // the per-leg depth-authority pass all follow precedence, not the order the
  // list was authored in. EMODnet's rank (10) slots it between ENC (0) and
  // OpenSeaMap (20) automatically.
  const providers: LegSafetyProvider[] = [
    createEncProvider({
      client: deps.client,
      queryChartedAreas: deps.queryChartedAreas,
      scanRouteCorridor: deps.scanRouteCorridor,
      logger: deps.logger
    }),
    createEmodnetProvider({
      client: deps.emodnet,
      logger: deps.logger
    }),
    createOpenSeaMapProvider({
      client: deps.overpass,
      queryTileWater: deps.queryTileWater,
      scanRouteCorridor: deps.scanRouteCorridor,
      logger: deps.logger
    })
  ].sort((a, b) => a.precedence - b.precedence)
  return runOrchestrator(providers, waypoints, params, deps.logger)
}

/** One active provider's contribution to a leg: its flags and the coverage it reported. */
interface ProviderContribution {
  provider: LegSafetyProvider
  flags: LegFlag[]
  /** The dimensions this provider returned data for on this leg, or undefined when its query threw. */
  coverage?: LegDimensionCoverage
}

/** True when a contribution returned data: its checkLeg did not throw (a throw leaves coverage undefined). */
const contributionRan = (c: ProviderContribution): boolean => c.coverage !== undefined

/** One leg's resolved providers and each one's contribution. */
interface LegOutcome {
  contributions: ProviderContribution[]
  active: LegSafetyProvider[]
  anyRan: boolean
}

/**
 * Run the provider list over the route as a per-leg union: per-leg depth and
 * land checks under a bounded-concurrency pool, the per-leg depth-authority pass
 * (the highest-precedence depth provider that returned data owns depth on a leg,
 * so a lower-precedence depth provider's depth flags are dropped there), one
 * route-level EMODnet awareness note when EMODnet was the effective depth
 * provider on any leg, the capability-keyed not-checked pass (with the depth note
 * collapsed to one route-level flag), then one contiguous-run hazard sweep per
 * hazard-capable provider over the legs it covers, deduped across providers by
 * charted position and type with the ENC reading preferred. Returns the flags in
 * a deterministic order (leg order for per-leg flags, then the route-level notes)
 * and whether any provider's leg query ran.
 *
 * Exported so the orchestrator's own behavior (the depth-authority pass in
 * particular) can be tested against SYNTHETIC providers, without contorting real
 * coordinates to fake a coverage overlap the real envelopes do not have.
 */
export async function runOrchestrator (
  providers: readonly LegSafetyProvider[],
  waypoints: Position[],
  params: LegCheckParams,
  logger?: Logger
): Promise<LegCheckResult> {
  // Process legs with a small bounded concurrency pool so independent provider
  // queries overlap without flooding the single upstream endpoint, collecting
  // each leg's outcome in leg order for a deterministic result.
  const legCount = waypoints.length - 1
  const checkStarted = Date.now()
  const outcomes = await mapWithConcurrency(
    Array.from({ length: legCount }, (_, leg) => leg),
    LEG_QUERY_CONCURRENCY,
    (leg) => runLeg(providers, leg, waypoints[leg], waypoints[leg + 1], params, logger)
  )

  // Per-leg depth-authority pass, then flatten each leg's surviving contributions
  // into the flag list in active (precedence) order. On a leg, the
  // HIGHEST-precedence depth provider that returned depth data is authoritative
  // for depth there, so a LOWER-precedence depth provider's depth-related flags
  // are dropped (its modeled reading must not contradict a higher source's
  // charted one). Tracked alongside: the legs where EMODnet was the EFFECTIVE
  // depth provider, for the single route-level awareness note synthesized below.
  const flags: LegFlag[] = []
  let anyLegRan = false
  let emodnetEffectiveLegs = 0
  for (const outcome of outcomes) {
    if (outcome.anyRan) anyLegRan = true
    // The highest-precedence depth-capable provider that returned depth data on
    // this leg, if any. `contributions` is in precedence order (active is), so
    // the first such contribution is the authoritative one.
    const depthAuthority = outcome.contributions.find(
      (c) => c.provider.capabilities.has('depth') && c.coverage?.depth === 'data'
    )?.provider
    for (const contribution of outcome.contributions) {
      const { provider } = contribution
      const superseded =
        depthAuthority !== undefined &&
        provider !== depthAuthority &&
        provider.capabilities.has('depth') &&
        provider.precedence > depthAuthority.precedence
      if (superseded) {
        // Drop this provider's depth-related flags so its reading cannot
        // contradict the higher source's. For a depth-ONLY provider (EMODnet)
        // every flag is depth-derived (its shallow, drying-as-land, gap, and
        // no-data notes all come from the modeled profile), so all are dropped.
        // A multi-capability depth provider keeps its non-depth flags; only the
        // depth verdicts (DEPTH_VERDICT_KINDS) go. ENC is highest precedence so
        // it is never superseded, so this branch is exercised by EMODnet today.
        const depthOnly = provider.capabilities.size === 1
        for (const flag of contribution.flags) {
          if (depthOnly || DEPTH_VERDICT_KINDS.has(flag.kind)) continue
          flags.push(flag)
        }
        continue
      }
      flags.push(...contribution.flags)
    }
    // EMODnet was the effective depth provider on this leg when it returned depth
    // data and was not superseded, i.e. it IS the depth authority for the leg.
    if (depthAuthority?.id === EMODNET_PROVIDER_ID) {
      emodnetEffectiveLegs += 1
    }
  }

  // One route-level EMODnet awareness note, synthesized when EMODnet was the
  // effective depth provider on at least one leg, parallel to the collapsed
  // depth-not-checked note below: a long European route carries one caveat, not
  // one per leg. The per-leg shallow, land, and gap flags stay leg-scoped.
  if (emodnetEffectiveLegs > 0) {
    flags.push({
      kind: 'other',
      message:
        `Depth on ${emodnetEffectiveLegs} of ${legCount} legs is EMODnet modeled bathymetry referenced to LAT, ` +
        'awareness-grade and not charted, verify on the chart.'
    })
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
      // Owned only by a provider that actually RETURNED data. A provider that
      // threw keeps coverage undefined, so it is not counted here and its
      // dimension falls to not-checked rather than silently passing on its
      // still-present active entry. A successful but no-data provider keeps
      // coverage defined and self-emits its own no-data note, so it still counts
      // (no double note).
      if (!outcomes[leg].contributions.some(
        (c) => contributionRan(c) && c.provider.capabilities.has(dimension)
      )) {
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
    // Collect each provider's hazard flags as its own group, in precedence order
    // (providers is sorted), so the dedupe stays CROSS-PROVIDER ONLY: the seen
    // set is consulted within a provider but updated only after that provider's
    // whole group is emitted.
    const perProviderHazards: LegFlag[][] = []
    for (const provider of providers) {
      if (provider.checkHazards === undefined || !provider.capabilities.has('hazards')) continue
      const checkHazards = provider.checkHazards
      const runs = contiguousRuns(legCount, (leg) => outcomes[leg].active.includes(provider))
      const hazStarted = Date.now()
      const perRun = await Promise.all(
        runs.map((run) =>
          checkHazards(run.map((leg) => ({ leg, from: waypoints[leg], to: waypoints[leg + 1] })), params))
      )
      logger?.debug(`check-timing: ${provider.id} hazard sweep over ${runs.length} run(s) ${Date.now() - hazStarted}ms`)
      perProviderHazards.push(perRun.flat())
    }
    // Cross-provider-ONLY dedupe. The position key is coarse (about 11 m at four
    // decimals), which is needed to match the SAME charted feature across ENC and
    // OpenSeaMap, but must not collapse two genuinely distinct same-type hazards a
    // single provider reports close together. So `seen` is consulted while
    // emitting a provider's group and only updated AFTER the group is emitted:
    // within one provider both hazards survive, while a lower-precedence
    // provider's hazard whose key a higher-precedence provider already emitted is
    // dropped. A flag with no hazardKey (a kind:'other' degrade note) is never
    // deduped away. The hazardKey is transient: it is stripped from every returned
    // flag (so it never reaches the response JSON) and the flag's own kind is
    // preserved, so a degrade note stays an `other` rather than being relabelled.
    const seenHazards = new Set<string>()
    for (const group of perProviderHazards) {
      const emittedKeys: string[] = []
      for (const flag of group) {
        if (flag.hazardKey !== undefined) {
          if (seenHazards.has(flag.hazardKey)) continue
          emittedKeys.push(flag.hazardKey)
        }
        const { hazardKey: _key, ...clean } = flag
        flags.push(clean)
      }
      for (const key of emittedKeys) seenHazards.add(key)
    }
  }

  logger?.debug(`check-timing: total ${Date.now() - checkStarted}ms over ${legCount} legs`)
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
 * Run every active provider for one leg, collecting each one's depth-and-land
 * flags and the coverage it reported, kept per provider so the orchestrator's
 * depth-authority pass can drop a superseded depth provider's flags. A provider
 * that throws degrades to a single `other` note for the leg and is treated as
 * not-run (coverage undefined); a provider that succeeds contributes its flags
 * and coverage. The active providers run concurrently so their round trips
 * overlap, but each one's contribution is gathered into its own slot and kept in
 * active order, so the flag sequence stays deterministic regardless of completion
 * order.
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
  const contributions = await Promise.all(active.map(async (provider): Promise<ProviderContribution> => {
    const started = Date.now()
    try {
      const result = await provider.checkLeg(leg, from, to, params)
      logger?.debug(`check-timing: leg ${leg} ${provider.id} checkLeg ${Date.now() - started}ms`)
      return { provider, flags: result.flags, coverage: result.coverage }
    } catch (error) {
      logger?.debug(`check-timing: leg ${leg} ${provider.id} checkLeg FAILED ${Date.now() - started}ms`)
      // At error level so a persistent provider outage is visible in normal logs; the leg still degrades to a not-checked flag.
      logger?.error(`leg ${leg} ${provider.id} checkLeg failed: ${String(error)}`)
      // No per-leg flag here. A thrown provider keeps coverage undefined, so the
      // capability-keyed not-checked pass above speaks for each dimension it could
      // not verify, in one collapsed note. The old hardcoded "depth not checked:
      // charted query failed" flag mislabeled a modeled (EMODnet) or land-only
      // (OpenSeaMap) provider's failure as a charted depth miss, and left a failed
      // sole land provider's leg with no land-not-checked note at all.
      return { provider, flags: [] }
    }
  }))
  const anyRan = contributions.some(contributionRan)
  return { contributions, active, anyRan }
}
