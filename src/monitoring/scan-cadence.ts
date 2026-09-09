/**
 * Scan cadence.
 *
 * An alarm that fires only while the vessel is inside a circle around a point
 * of interest is a sampling problem: the alarm can only be raised on an
 * evaluation, so a vessel that covers more ground between two evaluations than
 * the circle is wide passes straight through the alarm zone unseen. The
 * distance the vessel covers inside the zone is the chord of that circle along
 * the track, which shrinks to nothing for a point that grazes the edge, so no
 * sampling rate can promise every pass. This module turns the tightest alarm
 * radius the enabled outputs declare into the cadence the position monitor
 * samples at, and states the pass it promises.
 *
 * Two separate gates come out of it. The evaluation gate governs how often the
 * monitor re-runs the alarm checks against the list it already has: that is
 * pure geometry over an in-memory list, so it is cheap and runs close to the
 * position fix rate. The coverage gate governs how far the vessel may travel
 * before the fetched list stops describing the water around it, which forces a
 * new list request regardless of the ordinary refetch interval.
 */

import { vesselScanRadiusMeters } from '../shared/proximity-radius.js'
import { MS_PER_MINUTE, MS_PER_SECOND } from '../shared/time.js'
import type { PositionScanContributor } from '../outputs/output.js'

/**
 * How far off the track, as a fraction of the alarm radius, a point of interest
 * may pass and still be promised an evaluation while it is inside the radius.
 *
 * The along-track chord of the alarm circle for a point passing `f` of the
 * radius abeam is `2 * radius * sqrt(1 - f^2)`, which is the whole diameter
 * dead ahead and zero at the edge. Promising every pass is impossible, so the
 * cadence is sized for a pass at this fraction: 0.8 leaves a chord of
 * `1.2 * radius`, which covers every pass except one that clips the outer
 * fifth of the zone, where the vessel clears the point by four fifths of the
 * radius it configured.
 */
const COVERED_ABEAM_FRACTION = 0.8

/**
 * Shortest gap, in milliseconds, between two alarm evaluations. A position
 * source that publishes faster than the fix rate the alarms need (an NMEA 2000
 * feed at 10 Hz, say) would otherwise re-run every distance check on each
 * message for no gain.
 */
export const MIN_EVALUATION_INTERVAL_MS = MS_PER_SECOND

/**
 * Longest gap, in milliseconds, between two alarm evaluations. A stopped
 * vessel meets no distance threshold, so this keeps the checks running for the
 * transitions that do not come from motion: an air draft that appears
 * mid-voyage, and an alarm held past its reconfirmation window.
 */
export const MAX_EVALUATION_INTERVAL_MS = MS_PER_MINUTE

/**
 * Longest distance, in meters, the vessel may cover between two evaluations,
 * whatever the alarm radius. Half the chord already keeps the alarm zone from
 * being skipped; this caps how far into the zone the vessel can travel before
 * the alarm is raised, so a generous radius still alarms promptly rather than
 * hundreds of meters in.
 */
const MAX_EVALUATION_MOVE_METERS = 100

/**
 * Shortest distance, in meters, the vessel must cover between two evaluations.
 * A GPS fix wanders a few meters at rest, so a floor below this would re-run
 * the checks on receiver noise alone. It is the floor that makes a very tight
 * alarm radius unhonorable: see {@link ScanCadence.maxCoveredSpeedMps}.
 */
const MIN_EVALUATION_MOVE_METERS = 5

/** The sampling the position monitor runs its alarm checks at. */
export interface ScanCadence {
  /** Distance, in meters, the vessel must cover before the next evaluation. */
  evaluationMoveMeters: number
  /**
   * The along-track chord of the tightest alarm zone for a pass at
   * {@link COVERED_ABEAM_FRACTION} of the radius. Two evaluations further
   * apart than this can straddle the zone, so the monitor reports a gap wider
   * than this rather than letting it pass unremarked. `Infinity` when no
   * contributor declares a radius.
   */
  coveredChordMeters: number
  /**
   * Distance, in meters, the vessel may travel from the position a list was
   * fetched around before that list stops covering the tightest alarm zone.
   * Reaching it forces a new list request whatever the refetch interval says.
   * `Infinity` when no contributor declares a radius.
   */
  coverageMoveMeters: number
  /**
   * Speed, in meters per second, up to which this cadence promises the pass
   * described by {@link COVERED_ABEAM_FRACTION}, assuming position fixes at
   * least as often as {@link MIN_EVALUATION_INTERVAL_MS}. `0` when the tightest
   * declared radius cannot be honored at any speed, because the evaluation
   * distance floor is already wider than the alarm zone's chord. `Infinity`
   * when no contributor declares a radius, since nothing then depends on the
   * sampling rate.
   */
  maxCoveredSpeedMps: number
  /** The tightest alarm radius, in meters, any contributor declared. */
  tightestRadiusMeters?: number
}

/** Clamp `value` into the inclusive range, without a dependency for one line. */
function clamp (value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The along-track chord of an alarm circle for a point of interest passing
 * {@link COVERED_ABEAM_FRACTION} of the radius off the vessel's track.
 */
export function coveredChordMeters (radiusMeters: number): number {
  return 2 * radiusMeters * Math.sqrt(1 - COVERED_ABEAM_FRACTION ** 2)
}

/**
 * The tightest alarm radius, in meters, any cadence can resolve: the radius
 * whose chord is exactly the evaluation distance floor. Below it the floor is
 * already wider than the alarm zone, so a point of interest can cross the zone
 * between two evaluations however often the position publishes and however
 * slowly the vessel moves.
 */
export const SMALLEST_COVERED_RADIUS_METERS =
  MIN_EVALUATION_MOVE_METERS / coveredChordMeters(1)

/**
 * Derive the sampling cadence from the contributors that declare an alarm
 * radius. With none, every gate opens out to infinity and the monitor keeps
 * its list-request cadence as its only cadence, which is what a look-ahead
 * output needs and all a US-waters position feed needs.
 *
 * @param contributors The position-driven outputs' scan contributors.
 * @returns The gates the monitor samples with, and the pass they promise.
 */
export function deriveScanCadence (
  contributors: readonly PositionScanContributor[]
): ScanCadence {
  let tightestRadiusMeters: number | undefined
  let coverageMoveMeters = Infinity
  for (const contributor of contributors) {
    const radius = contributor.alarmRadiusMeters
    if (radius === undefined || !Number.isFinite(radius) || radius <= 0) {
      continue
    }
    if (tightestRadiusMeters === undefined || radius < tightestRadiusMeters) {
      tightestRadiusMeters = radius
    }
    // How far the vessel can leave the position the box was built around
    // before the box's edge reaches the alarm zone. The contributor sizes its
    // box with the same helper, which is the coupling the contract documents.
    coverageMoveMeters = Math.min(coverageMoveMeters, vesselScanRadiusMeters(radius) - radius)
  }

  if (tightestRadiusMeters === undefined) {
    return {
      evaluationMoveMeters: MAX_EVALUATION_MOVE_METERS,
      coveredChordMeters: Infinity,
      coverageMoveMeters: Infinity,
      maxCoveredSpeedMps: Infinity
    }
  }

  const chord = coveredChordMeters(tightestRadiusMeters)
  // Half the chord leaves a factor of two in hand for an uneven fix rate, and
  // the cap keeps a wide radius alarming promptly rather than deep into the
  // zone. The floor is what a very tight radius runs into.
  const evaluationMoveMeters = clamp(chord / 2, MIN_EVALUATION_MOVE_METERS, MAX_EVALUATION_MOVE_METERS)
  return {
    evaluationMoveMeters,
    coveredChordMeters: chord,
    coverageMoveMeters,
    // At speed the shortest interval is the binding gate, since the distance
    // threshold is met on every fix. A distance floor already wider than the
    // zone cannot be honored at any speed, however often the fixes arrive.
    maxCoveredSpeedMps: evaluationMoveMeters < chord
      ? chord / (MIN_EVALUATION_INTERVAL_MS / MS_PER_SECOND)
      : 0,
    tightestRadiusMeters
  }
}
