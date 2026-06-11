/**
 * Bridge air-draft comparison: the rules shared by the bridge air-draft output
 * (proximity), the route-hazard output (route-ahead), the config-schema
 * fragments, and the panel's normalize-config.
 *
 * Like `rating.ts` and `year-filter.ts`, the bounds, the default, the clamp,
 * and the schema-fragment builders live in one dependency-free module so the
 * node-side config resolution and the browser-side panel coercion cannot
 * drift. The module imports only the pure `toFiniteNumber` narrower, so the
 * webpack-bundled panel can import the bounds and the clamp without pulling in
 * any node-only code.
 *
 * The comparison is deliberately conservative: a clearance is compared against
 * the vessel air draft plus a margin, so a bridge whose charted clearance is
 * close to the masthead height warns rather than silently passing. The margin
 * is the crew's allowance for tide, datum, and loading, since a charted or
 * tagged clearance is a static figure.
 */

import { clampNumber, positiveFiniteNumber, toFiniteNumber } from './numbers.js'

/** SignalK self path carrying the vessel air draft (height above waterline), in meters. */
const SELF_AIR_HEIGHT_PATH = 'design.airHeight'

/** Lowest clearance margin: 0 is a strict `clearance <= airDraft` comparison. */
export const MIN_CLEARANCE_MARGIN_METERS = 0

/**
 * Highest clearance margin. Generous: a margin beyond this is almost certainly
 * a mis-entry, and the clamp keeps a hand-edited config from suppressing every
 * bridge by demanding tens of meters of headroom.
 */
export const MAX_CLEARANCE_MARGIN_METERS = 30

/** Default clearance margin, in meters: about 3 ft of headroom for tide and datum. */
export const DEFAULT_CLEARANCE_MARGIN_METERS = 1

/**
 * The "no configured fallback" sentinel for the vessel-air-draft config key.
 * Zero is a meaningful value, not an arbitrary default: it means "rely on the
 * `design.airHeight` data-model value alone", so {@link readVesselAirDraft}
 * ignores it as a fallback. Named so the panel's normalize-config and the
 * Alerts card read the intent rather than a bare `0`.
 */
export const NO_FALLBACK_AIR_DRAFT_METERS = 0

/**
 * Clamp a raw clearance-margin value to `[MIN, MAX]`. A non-numeric or
 * non-finite value falls back to {@link DEFAULT_CLEARANCE_MARGIN_METERS}. The
 * margin is fractional (meters with a decimal), so the value is not truncated.
 * Shared by the output's config resolution and the panel's normalize-config.
 */
export function clampClearanceMargin (raw: unknown): number {
  return clampNumber(raw, MIN_CLEARANCE_MARGIN_METERS, MAX_CLEARANCE_MARGIN_METERS, DEFAULT_CLEARANCE_MARGIN_METERS)
}

/** The minimal app surface {@link readVesselAirDraft} needs. */
export interface AirDraftApp {
  /** Read a value from the `vessels.self` data model. */
  getSelfPath: (path: string) => unknown
  /** Plugin debug logger. */
  debug: (message: string) => void
}

/**
 * Resolve the vessel air draft, in meters, for the clearance comparison.
 *
 * Reads `design.airHeight` from the SignalK data model first; the data model
 * stores it in meters (SI), so the bare value is used directly, mirroring how
 * `course-reader.ts` reads speed over ground. When `design.airHeight` is
 * absent or not a positive finite number, it falls back to `fallbackMeters`
 * (the plugin-config air draft) when that is positive and finite. Returns
 * `null` when neither yields a usable value, leaving the air-draft check
 * inert.
 *
 * The `design.airHeight` read also tolerates a `{ value }` wrapper, since the
 * data model occasionally returns the metadata-wrapped form; the wrapped value
 * is unwrapped before narrowing.
 */
export function readVesselAirDraft (app: AirDraftApp, fallbackMeters?: number): number | null {
  let raw: unknown
  try {
    raw = app.getSelfPath(SELF_AIR_HEIGHT_PATH)
  } catch (error) {
    app.debug(`Bridge air-draft check could not read ${SELF_AIR_HEIGHT_PATH}: ${String(error)}`)
    raw = undefined
  }
  // Air draft is only meaningful as a positive value, so narrow with
  // positiveFiniteNumber: a zero, negative, or non-finite reading is treated as
  // "no usable air draft" and falls through to the configured fallback.
  const fromModel = positiveFiniteNumber(raw) ??
    (typeof raw === 'object' && raw !== null
      ? positiveFiniteNumber((raw as { value?: unknown }).value)
      : null)
  if (fromModel !== null) {
    return fromModel
  }
  return positiveFiniteNumber(fallbackMeters)
}

/**
 * True when a bridge would not clear the vessel: its vertical clearance is at
 * or below the air draft plus the safety margin. Any non-finite input (an
 * unknown clearance, an unknown air draft) returns false, so a bridge only
 * warns on a real, known too-low clearance.
 */
export function bridgeBlocksVessel (
  clearanceMeters: number | null | undefined,
  airDraftMeters: number | null | undefined,
  marginMeters: number
): boolean {
  const clearance = toFiniteNumber(clearanceMeters)
  const airDraft = toFiniteNumber(airDraftMeters)
  const margin = toFiniteNumber(marginMeters) ?? DEFAULT_CLEARANCE_MARGIN_METERS
  if (clearance === null || airDraft === null) {
    return false
  }
  return clearance <= airDraft + margin
}

/**
 * Format a meters value for a human-readable alarm message: rounded to one
 * decimal place, with a trailing `.0` dropped so a whole number reads `5 m`
 * rather than `5.0 m`, and a converted value (15 ft to 4.572 m) reads `4.6 m`.
 * Shared by the bridge clearance alarm and the route-hazard clearance clause so
 * the two messages format clearances identically.
 */
export function formatMeters (meters: number): string {
  return (Math.round(meters * 10) / 10).toString()
}

/** Config-schema fragment for the bridge air-draft check toggle. */
export function enableBridgeAirDraftSchema (title: string): Record<string, unknown> {
  return { type: 'boolean', title, default: false }
}

/**
 * Config-schema fragment for the fallback air-draft field, in meters. `0` (the
 * default) means rely on `design.airHeight` alone.
 */
export function vesselAirDraftSchema (title: string): Record<string, unknown> {
  return { type: 'number', title, default: 0, minimum: 0 }
}

/** Config-schema fragment for the clearance-margin field, in meters. */
export function clearanceMarginSchema (title: string): Record<string, unknown> {
  return {
    type: 'number',
    title,
    default: DEFAULT_CLEARANCE_MARGIN_METERS,
    minimum: MIN_CLEARANCE_MARGIN_METERS,
    maximum: MAX_CLEARANCE_MARGIN_METERS
  }
}
