/**
 * The EMODnet leg-safety provider.
 *
 * This supplies EUROPEAN MODELED DEPTH (the EMODnet bathymetry depth profile
 * along a leg) as a depth-only {@link LegSafetyProvider}, so the orchestrator in
 * safety-check.ts can run it alongside the chart-backed providers. It is gated to
 * the European EMODnet envelope: `coversLeg` is true only when both leg endpoints
 * sit inside it. The model proposes the waypoints; this owned code disposes the
 * `shallow` and `land` flags from the modeled profile.
 *
 * The single most important honesty point, encoded in behavior: EMODnet depth is
 * MODELED bathymetry referenced to LAT, awareness-grade and NOT charted, distinct
 * from ENC's authoritative MLLW charted depth. Profile values are signed meters,
 * NEGATIVE below datum, so the shallowest navigable reading on a leg is
 * `Math.max(...samples)` (the value closest to zero). A POSITIVE sample is an
 * above-datum elevation (drying or land), NOT a depth, so it is flagged as land
 * with the height above LAT and never printed as a negative depth, mirroring the
 * ENC drying-as-land rule. The awareness-grade caveat is NOT emitted per leg: the
 * orchestrator synthesizes one route-level note when EMODnet was the effective
 * depth provider on at least one leg, so a long European route carries one caveat
 * rather than one per leg.
 *
 * Depth is the only capability: no land standoff, no point hazards. The provider
 * self-emits its own no-data flag (an empty profile or a failed query), so the
 * orchestrator's capability-keyed not-checked pass never doubles it for a leg
 * this provider covers.
 *
 * The provider is injectable and mostly pure: `deps` carries the EMODnet client
 * and an optional logger, so a test stubs them without live HTTP.
 */

import { isInEmodnetCoverage } from '../../shared/regions.js'
import { formatMeters } from '../../shared/format-meters.js'
import type { EmodnetClient, EmodnetProfile } from '../emodnet/emodnet-client.js'
import type { Logger, Position } from '../../shared/types.js'
import type { LegFlag, LegCheckParams } from '../safety-check.js'
import { EMODNET_PRECEDENCE, EMODNET_PROVIDER_ID } from './provider.js'
import type {
  Dimension,
  LegProviderResult,
  LegSafetyProvider
} from './provider.js'

/** The single dimension this provider supplies: modeled depth, never land or hazards. */
const EMODNET_CAPABILITIES: ReadonlySet<Dimension> = new Set<Dimension>(['depth'])

/** Injected collaborators for the EMODnet provider. */
export interface EmodnetProviderDeps {
  /** The EMODnet depth-profile client. */
  client: EmodnetClient
  /** Optional logger for the degrade path. */
  logger?: Logger
}

/**
 * Build the EMODnet leg-safety provider over the injected EMODnet client and
 * optional logger. The provider supplies modeled depth over the European EMODnet
 * envelope; land and hazards are never its capabilities.
 */
export function createEmodnetProvider (deps: EmodnetProviderDeps): LegSafetyProvider {
  return {
    id: EMODNET_PROVIDER_ID,
    capabilities: EMODNET_CAPABILITIES,
    precedence: EMODNET_PRECEDENCE,
    // EMODnet bathymetry covers the European seas only, so the provider reaches a
    // leg only when both endpoints sit inside the envelope.
    coversLeg: (from, to) => isInEmodnetCoverage(from) && isInEmodnetCoverage(to),
    /**
     * Run one leg's modeled-depth check, reporting only what this provider
     * verifies: the shallow or land flag from the profile and the depth coverage.
     * A rejected profile query degrades to a depth-not-checked note (with depth
     * coverage nodata) rather than throwing, because this provider self-emits its
     * own no-data flag and the orchestrator's not-checked pass must not double it.
     */
    async checkLeg (
      leg: number,
      from: Position,
      to: Position,
      params: LegCheckParams
    ): Promise<LegProviderResult> {
      const flags: LegFlag[] = []

      let profile: EmodnetProfile
      try {
        profile = await deps.client.depthProfile(from, to, params.signal)
      } catch (error) {
        deps.logger?.debug(`leg ${leg} EMODnet depth query failed: ${String(error)}`)
        flags.push({ leg, kind: 'other', message: 'depth not checked for this leg: the EMODnet query failed' })
        return { flags, coverage: { depth: 'nodata' } }
      }

      if (profile.samples.length === 0) {
        flags.push({ leg, kind: 'other', message: 'no EMODnet modeled depth here, verify on the chart' })
        return { flags, coverage: { depth: 'nodata' } }
      }

      // Profile values are signed meters, negative below LAT, so the shallowest
      // navigable reading is the value closest to zero, the maximum of the samples.
      // A plain loop, not Math.max(...samples): the profile length scales with leg
      // length, so spreading the array as call arguments would risk a call-stack
      // limit on a long leg.
      let shallowest = profile.samples[0]
      for (const sample of profile.samples) {
        if (sample > shallowest) shallowest = sample
      }
      const minimalSafetyContourMeters = params.draftMeters + params.safetyMarginMeters
      if (shallowest >= 0) {
        // A positive sample is an above-datum elevation (drying or land), not a
        // depth. Never print a negative depth; classify it as land with the height
        // above LAT, mirroring the ENC drying-as-land rule.
        flags.push({
          leg,
          kind: 'land',
          message: `EMODnet modeled terrain is ${formatMeters(shallowest)} m above LAT on this leg (drying or land), verify on the chart`
        })
      } else if (-shallowest < minimalSafetyContourMeters) {
        flags.push({
          leg,
          kind: 'shallow',
          message: `EMODnet modeled depth ${formatMeters(-shallowest)} m, LAT, awareness-grade and not charted, under the ${formatMeters(minimalSafetyContourMeters)} m draft-plus-margin contour`
        })
      }

      if (profile.hadGap) {
        flags.push({
          leg,
          kind: 'other',
          message: 'EMODnet modeled depth is incomplete on this leg, gaps not checked, verify on the chart'
        })
      }

      // The awareness caveat is the orchestrator's job, not this provider's: it
      // synthesizes ONE route-level note when EMODnet was the effective depth
      // provider on at least one leg, so a long European route carries one caveat
      // rather than one per leg. Returning depth coverage 'data' is the signal the
      // orchestrator reads to decide that.
      return { flags, coverage: { depth: 'data' } }
    }
  }
}
