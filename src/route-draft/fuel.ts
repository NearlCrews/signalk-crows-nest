/**
 * Deterministic route distance and fuel math for the route-draft module.
 *
 * These numbers are computed in code, never by the LLM, and reported honestly.
 * The model proposes turning waypoints; this module totals the rhumb-line
 * distance Binnacle's editor draws and measures, then estimates the fuel a leg
 * needs from the vessel's cruise speed and burn rate.
 *
 * Everything here is pure. The caller converts the vessel's configured burn
 * rate into liters per hour and reads its fuel aboard in liters before calling,
 * so this module works in one volume unit (liters) and reports liters.
 *
 * Honesty is the point, not a feature:
 *
 * - The head-sea derate is a SINGLE FLAT assumption, not a sea-state model. The
 *   factor used is stated verbatim in `derateNote` on every estimate, so the
 *   navigator reads the assumption rather than trusting a bare number.
 * - For a SAILING vessel with no motoring fraction given, this does NOT
 *   fabricate a motoring burn. It returns `undefined` plus a `reason` so the
 *   caller can surface "fuel not estimated for sail unless a motoring fraction
 *   is given," never a made-up figure.
 * - `marginPct` is an ESTIMATE of the margin against fuel aboard, never worded
 *   or treated as a guarantee. The navigator owns the real reserve.
 */

import { rhumbDistanceMeters } from '../geo/position-utilities.js'
import { METERS_PER_NAUTICAL_MILE } from '../shared/length.js'
import { clampNumber, roundTo } from '../shared/numbers.js'
import type { Position } from '../shared/types.js'

/**
 * The flat head-sea derate applied to range. A vessel punching into a head sea
 * makes less ground per unit of fuel than in flat water; lacking a sea-state
 * model, the estimate assumes a single conservative penalty and STATES it. This
 * is the one assumption the navigator most needs to see, so it rides on every
 * estimate as `derateNote`.
 */
export const DEFAULT_HEAD_SEA_DERATE = 0.25

/** Propulsion kind, mirroring the vessel config's `propulsion` setting. */
export type Propulsion = 'sail' | 'power' | 'motorsail'

/** Inputs to {@link estimateFuel}. All volumes are liters; speed is knots. */
export interface FuelParams {
  /** The drafted route's total rhumb distance, in meters. */
  routeDistanceMeters: number
  /** The vessel's propulsion kind. A `sail` vessel needs a motoring fraction. */
  propulsion: Propulsion
  /** Cruise speed under power, in knots (nautical miles per hour). */
  cruiseSpeedKn: number
  /** Burn at cruise, in liters per hour (the caller converts from config units). */
  burnAtCruise: number
  /** Reserve to hold back, as a percent of fuel aboard (0..100). */
  reservePercent: number
  /** Fuel aboard now, in liters, summed across tanks by the caller. Optional. */
  fuelAboardLiters?: number
  /**
   * Flat head-sea derate, 0..1. Defaults to {@link DEFAULT_HEAD_SEA_DERATE}.
   * A value of 0.25 means 25 percent more fuel is budgeted for the distance.
   */
  headSeaDerate?: number
  /**
   * Fraction of the passage a SAILING vessel expects to motor, 0..1. Required
   * to estimate fuel for `sail`: without it this module returns no estimate
   * rather than assuming a motoring fraction. Ignored for `power` (always 1)
   * and treated as advisory for `motorsail` (defaults to 1 when absent).
   */
  motoringFraction?: number
}

/**
 * A deterministic fuel estimate, named to map directly onto the contract's
 * `fuel?: { neededL, aboardL?, marginPct?, derateNote? }` object.
 */
export interface FuelEstimate {
  /** Fuel needed for the drafted distance, in liters, after the head-sea derate. */
  neededL: number
  /** Fuel aboard, in liters, echoed when the caller supplied it. */
  aboardL?: number
  /**
   * Estimated margin against fuel aboard after holding back the reserve, as a
   * percent of need: `(usableAboard - needed) / needed * 100`, rounded. Positive
   * is surplus, negative is shortfall. An ESTIMATE, never a guarantee. Absent
   * when no fuel aboard was supplied.
   */
  marginPct?: number
  /** The flat head-sea derate assumption, stated in words. */
  derateNote: string
}

/** Why a fuel estimate could not be produced, for the caller to surface honestly. */
export type FuelUnavailableReason =
  | 'sail-no-motoring-fraction'
  | 'no-burn-rate'
  | 'no-cruise-speed'

/**
 * Total a route's rhumb-line distance, in meters.
 *
 * Sums the loxodromic length of each leg between consecutive waypoints, the
 * same constant-bearing line Binnacle's editor draws, so the distance matches
 * what the navigator sees on the chart. Fewer than two waypoints is zero
 * distance, not an error: a single point or an empty route has no legs.
 */
export function routeDistanceMeters (waypoints: Position[]): number {
  let total = 0
  for (let i = 1; i < waypoints.length; i += 1) {
    total += rhumbDistanceMeters(waypoints[i - 1], waypoints[i])
  }
  return total
}

/** The `derateNote` text for a given flat derate factor, stated as a percent. */
function derateNoteFor (derate: number): string {
  const percent = Math.round(derate * 100)
  return `assumes a flat ${percent} percent head-sea derate`
}

/**
 * Estimate the fuel a drafted route needs, honestly.
 *
 * Derives nautical-miles-per-liter from cruise speed over burn at cruise,
 * scales it to the route distance, applies the flat head-sea derate, and (when
 * fuel aboard is known) reports the estimated margin after the reserve. Returns
 * `undefined` with a `reason` rather than a fabricated number when the inputs
 * cannot honestly support an estimate: a sailing vessel with no motoring
 * fraction, a missing or non-positive burn rate, or a missing or non-positive
 * cruise speed.
 *
 * @returns the estimate, or `{ reason }` when no honest estimate is possible.
 */
export function estimateFuel (
  params: FuelParams
): FuelEstimate | { reason: FuelUnavailableReason } {
  const {
    routeDistanceMeters,
    propulsion,
    cruiseSpeedKn,
    burnAtCruise,
    reservePercent,
    fuelAboardLiters,
    headSeaDerate = DEFAULT_HEAD_SEA_DERATE,
    motoringFraction
  } = params

  // A sailing vessel that gave no motoring fraction gets no fabricated burn.
  // motorsail defaults to fully under power; power always motors.
  let motoring: number
  if (propulsion === 'sail') {
    if (motoringFraction === undefined) {
      return { reason: 'sail-no-motoring-fraction' }
    }
    motoring = motoringFraction
  } else if (propulsion === 'motorsail') {
    motoring = motoringFraction ?? 1
  } else {
    motoring = 1
  }

  if (!(burnAtCruise > 0)) {
    return { reason: 'no-burn-rate' }
  }
  if (!(cruiseSpeedKn > 0)) {
    return { reason: 'no-cruise-speed' }
  }

  const distanceNm = routeDistanceMeters / METERS_PER_NAUTICAL_MILE
  // Cruise speed in knots IS nautical miles per hour, and burn is liters per
  // hour, so liters per nautical mile is burn over speed. The motoring fraction
  // scales the distance actually made under power.
  const litersPerNm = burnAtCruise / cruiseSpeedKn
  const baseNeeded = distanceNm * motoring * litersPerNm
  // The flat derate budgets extra fuel for the same ground in a head sea.
  const neededL = roundTo(baseNeeded * (1 + headSeaDerate), 1)

  const estimate: FuelEstimate = {
    neededL,
    derateNote: derateNoteFor(headSeaDerate)
  }

  if (fuelAboardLiters !== undefined) {
    estimate.aboardL = fuelAboardLiters
    // Hold back the reserve before comparing, then express the surplus or
    // shortfall as a percent of need. An estimate, never a guarantee.
    const usableAboard = fuelAboardLiters * (1 - clampNumber(reservePercent, 0, 100, 0) / 100)
    if (neededL > 0) {
      estimate.marginPct = Math.round(((usableAboard - neededL) / neededL) * 100)
    }
  }

  return estimate
}
