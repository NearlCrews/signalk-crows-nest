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

/** Per-leg coverage a provider reports for each dimension it is responsible for. */
export interface LegDimensionCoverage {
  depth?: Coverage
  land?: Coverage
}

/** The dimensions a provider can supply. */
export type Dimension = 'depth' | 'land' | 'hazards'

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
  /** True when this provider's footprint reaches the leg. OSM is global. */
  coversLeg: (from: Position, to: Position) => boolean
  /** Per-leg depth and land flags plus which dimensions returned data. */
  checkLeg: (leg: number, from: Position, to: Position, params: LegCheckParams) => Promise<LegProviderResult>
  /** Hazard sweep over the legs this provider covers; flags carry global indices. */
  checkHazards?: (legs: LegRef[], params: LegCheckParams) => Promise<LegFlag[]>
}

/**
 * The active providers for one leg: every provider whose footprint reaches it.
 * Order follows the input provider list, which the orchestrator builds in
 * precedence order (ENC, then EMODnet, then OpenSeaMap).
 */
export function resolveProviders (
  providers: readonly LegSafetyProvider[],
  from: Position,
  to: Position
): LegSafetyProvider[] {
  return providers.filter((p) => p.coversLeg(from, to))
}
