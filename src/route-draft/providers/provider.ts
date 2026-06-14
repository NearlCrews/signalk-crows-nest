/**
 * The route-draft leg-safety provider contract and the per-leg region resolver.
 *
 * Each provider declares the dimensions it supplies (depth, land, hazards) and
 * its geographic footprint. The resolver owns coverage truth: per leg it returns
 * the union of every provider whose footprint reaches the leg. The orchestrator
 * (safety-check.ts) runs that set and decides not-checked emission by which
 * dimensions a responsible provider actually verified.
 */

import type { LegFlag, LegCheckParams } from '../safety-check.js'
import type { Position } from '../../shared/types.js'

/** Whether a responsible provider returned data for a dimension, or none. */
export type Coverage = 'data' | 'nodata'

/**
 * Per-leg coverage a provider reports for the `checkLeg` dimensions only, depth
 * and land. Hazards are deliberately absent here: the route-wide hazard sweep
 * emits its own explicit "not checked" flag (see {@link LegSafetyProvider.checkHazards}),
 * so the orchestrator never reads a hazards-coverage signal off this shape.
 */
export interface LegDimensionCoverage {
  depth?: Coverage
  land?: Coverage
}

/** The dimensions a provider can supply. */
export type Dimension = 'depth' | 'land' | 'hazards'

/**
 * Provider {@link LegSafetyProvider.precedence} ranks, LOWER is HIGHER
 * authority. ENC, the authoritative chart source, ranks above EMODnet's modeled
 * bathymetry, which ranks above OpenSeaMap. Named here so the ordering lives in
 * one place rather than as magic numbers in each provider. EMODnet sits at 10,
 * between ENC's authoritative MLLW charted depth and OpenSeaMap's coastline.
 */
export const ENC_PRECEDENCE = 0
export const EMODNET_PRECEDENCE = 10
export const OPENSEAMAP_PRECEDENCE = 20

/** A covered leg with its global index and endpoints, handed to checkHazards. */
export interface LegRef {
  leg: number
  from: Position
  to: Position
}

/** One leg's depth-and-land result from a provider. */
export interface LegProviderResult {
  flags: LegFlag[]
  coverage: LegDimensionCoverage
}

/** A leg-safety provider over one data source. */
export interface LegSafetyProvider {
  id: string
  capabilities: ReadonlySet<Dimension>
  /**
   * Authority rank, LOWER is HIGHER precedence: the orchestrator sorts the
   * provider list by this field, so it drives the merge order and the
   * cross-provider hazard dedupe (a higher-precedence provider's hazard reading
   * is kept over a lower one's at the same charted position). ENC, the
   * authoritative chart source, is 0; OpenSeaMap is 20, leaving a gap (e.g. 10)
   * for EMODnet between them. Precedence is this explicit field, never the order
   * the provider list happens to be authored in.
   */
  precedence: number
  /** True when this provider's footprint reaches the leg. OSM is global. */
  coversLeg: (from: Position, to: Position) => boolean
  /**
   * Per-leg depth and land flags plus which dimensions returned data. `leg` is
   * the global leg index, the index into the route's full waypoint list, matching
   * {@link LegRef.leg}.
   */
  checkLeg: (leg: number, from: Position, to: Position, params: LegCheckParams) => Promise<LegProviderResult>
  /**
   * Hazard sweep over the legs this provider covers; flags carry global indices.
   * Hazards are not part of {@link LegDimensionCoverage} because this route-wide
   * sweep emits its own explicit "not checked" flag on a failed or unservable
   * query, the same way a per-leg depth or land query degrades, so the
   * orchestrator never needs a synthesized hazards-coverage signal.
   *
   * Precondition: `legs` must be a CONTIGUOUS run, consecutive global indices
   * sharing endpoints, because the scan stitches them into one polyline and
   * measures along-track distance over it. A non-contiguous set would fabricate
   * a segment between two unconnected legs and misattribute hazards along it, so
   * a provider covering a gapped subset of legs must call this once per
   * contiguous run.
   */
  checkHazards?: (legs: LegRef[], params: LegCheckParams) => Promise<LegFlag[]>
}

/**
 * The active providers for one leg: every provider whose footprint reaches it.
 * The returned order preserves the input list order, which the orchestrator has
 * already sorted by the explicit {@link LegSafetyProvider.precedence} field
 * (ENC, then EMODnet later, then OpenSeaMap), so authority is the precedence
 * field, never the order the provider list was authored in.
 */
export function resolveProviders (
  providers: readonly LegSafetyProvider[],
  from: Position,
  to: Position
): LegSafetyProvider[] {
  return providers.filter((p) => p.coversLeg(from, to))
}

/**
 * The cross-provider hazard dedupe key: a lowercased hazard type word and the
 * charted position to four decimals (about 11 m), colon-joined. Both the ENC and
 * OpenSeaMap providers set this on their hazard flags. The orchestrator dedupes
 * CROSS-PROVIDER ONLY: a lower-precedence provider's hazard whose key a
 * higher-precedence provider already emitted is dropped (so the ENC reading
 * wins), but two hazards a SINGLE provider reports at the same coarse key both
 * survive. The key lives here, called by both providers, so the precision, the
 * separator, and the lowercasing cannot drift between the two sites and silently
 * stop the same charted hazard from colliding. The ENC layer keys (wreck,
 * obstruction, rock) already match the OpenSeaMap seamark labels lowercased, so
 * the same feature reported by both yields the same key.
 */
export function hazardDedupeKey (typeWord: string, position: Position): string {
  return `${typeWord.toLowerCase()}:${position.latitude.toFixed(4)}:${position.longitude.toFixed(4)}`
}
