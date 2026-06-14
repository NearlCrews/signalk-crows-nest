/**
 * Config contract for the route-draft module: the `RouteDraftConfig` type, the
 * bounds, the defaults, the clamps, and the config-schema fragment builder.
 *
 * Like the shared bounds modules (`proximity-radius.ts`, `route-corridor.ts`,
 * `bridge-clearance.ts`), every numeric field's default, floor, and ceiling
 * live here once, and both the schema fragment and the panel section read them
 * from this module, so the form and the schema cannot drift. The fragment
 * delegates each numeric field to `boundedNumberSchema`, the same constructor
 * the other modules use.
 *
 * This module is dependency-free apart from the browser-safe `numbers` and
 * `config-schema` helpers and the `Propulsion` union from `shared/types.ts`, so
 * the webpack-bundled panel imports the bounds and the defaults directly rather
 * than keeping a hand-synced copy.
 *
 * Storage is SI: lengths in meters, volume in liters. The panel renders lengths
 * in the server's preferred display unit at the edge; the stored config never
 * changes shape. There is no panel-local unit toggle.
 */

import { boundedNumberSchema } from '../shared/config-schema.js'
import { clampNumber } from '../shared/numbers.js'
import { presentString } from '../shared/strings.js'
import type { Propulsion, PluginConfig } from '../shared/types.js'

/** Propulsion kind, re-exported from shared types so config consumers keep one import. */
export type RouteDraftPropulsion = Propulsion

// --- OpenRouter ---------------------------------------------------------------

/** Default model slug. Gemini Flash-Lite supports strict structured outputs and is the cheapest, fastest verified route. */
export const DEFAULT_ROUTE_DRAFT_MODEL = 'google/gemini-2.5-flash-lite'

/** Default daily OpenRouter call cap. Bounds calls, not dollars (see budget.ts). */
export const DEFAULT_MAX_CALLS_PER_DAY = 25

/** Floor on the daily call cap: at least one draft per day, or disable the feature. */
export const MIN_MAX_CALLS_PER_DAY = 1

/**
 * Ceiling on the daily call cap. Generous: a hundred drafts a day is far past
 * any single navigator's planning, and the cap exists to bound spend, so this
 * keeps a hand-edited config from removing the guard entirely.
 */
export const MAX_MAX_CALLS_PER_DAY = 100

// --- Vessel -------------------------------------------------------------------

/** Default propulsion when none is configured. Power is the safe assumption for fuel. */
export const DEFAULT_PROPULSION: RouteDraftPropulsion = 'power'

/** Floor on the vessel draft, in meters. Zero means rely on `design.draft` alone. */
export const MIN_DRAFT_METERS = 0

/** Ceiling on the vessel draft, in meters. Past any cruising hull. */
export const MAX_DRAFT_METERS = 30

/** Default vessel draft, in meters. Zero defers to `design.draft.value.maximum`. */
export const DEFAULT_DRAFT_METERS = 0

/** Default depth safety margin added to the draft, in meters. */
export const DEFAULT_SAFETY_MARGIN_METERS = 0.5

/** Floor on the safety margin, in meters. Zero is a strict draft comparison. */
export const MIN_SAFETY_MARGIN_METERS = 0

/** Ceiling on the safety margin, in meters. */
export const MAX_SAFETY_MARGIN_METERS = 20

/** Default closest-hauled tacking angle, in degrees off the true wind. */
export const DEFAULT_TACKING_ANGLE_DEG = 100

/** Floor on the tacking angle, in degrees. Below this no real hull points. */
export const MIN_TACKING_ANGLE_DEG = 30

/** Ceiling on the tacking angle, in degrees. At 180 the vessel runs dead downwind. */
export const MAX_TACKING_ANGLE_DEG = 180

// --- Fuel ---------------------------------------------------------------------

/** Default cruise speed under power, in knots. */
export const DEFAULT_CRUISE_SPEED_KN = 6

/** Floor on cruise speed, in knots. Zero would make the fuel math undefined. */
export const MIN_CRUISE_SPEED_KN = 0

/** Ceiling on cruise speed, in knots. Past any displacement cruiser. */
export const MAX_CRUISE_SPEED_KN = 60

/** Default burn at cruise, in liters per hour. */
export const DEFAULT_BURN_LITERS_PER_HOUR = 4

/** Floor on burn, in liters per hour. Zero leaves fuel unestimated. */
export const MIN_BURN_LITERS_PER_HOUR = 0

/** Ceiling on burn, in liters per hour. */
export const MAX_BURN_LITERS_PER_HOUR = 500

/** Default reserve held back, as a percent of fuel aboard. */
export const DEFAULT_RESERVE_PERCENT = 20

/** Floor on the reserve percent: hold back nothing. */
export const MIN_RESERVE_PERCENT = 0

/** Ceiling on the reserve percent: never report more than the tank. */
export const MAX_RESERVE_PERCENT = 90

// --- Routing ------------------------------------------------------------------

/** Default standoff (offing) kept off charted land, in nautical miles. */
export const DEFAULT_STANDOFF_NM = 0.5

/** Floor on the standoff, in nautical miles. Zero disables the standoff flag. */
export const MIN_STANDOFF_NM = 0

/** Ceiling on the standoff, in nautical miles. */
export const MAX_STANDOFF_NM = 20

/**
 * Default max leg length, in nautical miles, above which the prompt asks the
 * model to insert a turning waypoint. Distinct from the internal 0.5 nm depth
 * sample spacing, which is not user config.
 */
export const DEFAULT_MAX_LEG_NM = 20

/** Floor on the max leg length, in nautical miles. */
export const MIN_MAX_LEG_NM = 1

/** Ceiling on the max leg length, in nautical miles. */
export const MAX_MAX_LEG_NM = 200

/** The propulsion values, in panel display order, paired with their labels. */
export const PROPULSION_CHOICES: ReadonlyArray<{ value: RouteDraftPropulsion, label: string }> = [
  { value: 'sail', label: 'Sail' },
  { value: 'power', label: 'Power' },
  { value: 'motorsail', label: 'Motorsail' }
]

/** The route-draft module's configuration, all keys namespaced `routeDraft*`. */
export interface RouteDraftConfig {
  /** Master opt-in for AI route drafting. Off until an admin enables it. */
  routeDraftEnabled: boolean
  /** OpenRouter API key, stored plaintext at rest, so the panel field is masked. */
  routeDraftOpenRouterApiKey: string
  /** OpenRouter model slug. */
  routeDraftModel: string
  /** Daily OpenRouter call cap. Bounds calls per UTC day, not dollars. */
  routeDraftMaxCallsPerDay: number
  /** Vessel propulsion kind, the primary source for the fuel and sailability math. */
  routeDraftPropulsion: RouteDraftPropulsion
  /** Vessel draft, in meters. Zero defers to `design.draft.value.maximum`. */
  routeDraftDraftMeters: number
  /** Depth safety margin added to the draft, in meters. */
  routeDraftSafetyMarginMeters: number
  /** Closest-hauled tacking angle, in degrees off the true wind. */
  routeDraftTackingAngleDeg: number
  /** Cruise speed under power, in knots. */
  routeDraftCruiseSpeedKn: number
  /** Burn at cruise, in liters per hour. */
  routeDraftBurnLitersPerHour: number
  /** Reserve held back before reporting the margin, as a percent of fuel aboard. */
  routeDraftReservePercent: number
  /** Standoff (offing) kept off charted land, in nautical miles. */
  routeDraftStandoffNm: number
  /** Max leg length above which the prompt asks the model to add a turn, in nautical miles. */
  routeDraftMaxLegNm: number
}

// Compile-time guard: every RouteDraftConfig field must exist as an optional wire field on
// PluginConfig, so the runtime shape cannot gain a field the wire shape forgot. Exported so the
// linter and noUnusedLocals treat it as used, the same witness idiom the panel POI-type groups use.
type RouteDraftKeysOnWire = keyof RouteDraftConfig extends keyof PluginConfig ? true : never
export const ROUTE_DRAFT_CONFIG_KEYS_WITNESS: RouteDraftKeysOnWire = true

/** Resolve the stored propulsion value, falling back to the default on anything unknown. */
export function resolvePropulsion (raw: unknown): RouteDraftPropulsion {
  return raw === 'sail' || raw === 'power' || raw === 'motorsail' ? raw : DEFAULT_PROPULSION
}

/**
 * Coerce an untyped stored config into a fully populated `RouteDraftConfig`.
 *
 * Mirrors the panel's `normalizeConfig`: every numeric field clamps to its
 * shared bounds (a non-numeric or out-of-range stored value lands on the
 * default or the nearest bound rather than reaching the runtime), the toggle
 * defaults off, and the key and model default to a usable value. The call cap
 * truncates to an integer, matching its schema.
 */
export function normalizeRouteDraftConfig (raw: unknown): RouteDraftConfig {
  const c = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {}
  return {
    routeDraftEnabled: c.routeDraftEnabled === true,
    routeDraftOpenRouterApiKey: presentString(c.routeDraftOpenRouterApiKey) ?? '',
    routeDraftModel: presentString(c.routeDraftModel) ?? DEFAULT_ROUTE_DRAFT_MODEL,
    routeDraftMaxCallsPerDay: clampNumber(
      c.routeDraftMaxCallsPerDay, MIN_MAX_CALLS_PER_DAY, MAX_MAX_CALLS_PER_DAY, DEFAULT_MAX_CALLS_PER_DAY, true
    ),
    routeDraftPropulsion: resolvePropulsion(c.routeDraftPropulsion),
    routeDraftDraftMeters: clampNumber(
      c.routeDraftDraftMeters, MIN_DRAFT_METERS, MAX_DRAFT_METERS, DEFAULT_DRAFT_METERS
    ),
    routeDraftSafetyMarginMeters: clampNumber(
      c.routeDraftSafetyMarginMeters, MIN_SAFETY_MARGIN_METERS, MAX_SAFETY_MARGIN_METERS, DEFAULT_SAFETY_MARGIN_METERS
    ),
    routeDraftTackingAngleDeg: clampNumber(
      c.routeDraftTackingAngleDeg, MIN_TACKING_ANGLE_DEG, MAX_TACKING_ANGLE_DEG, DEFAULT_TACKING_ANGLE_DEG
    ),
    routeDraftCruiseSpeedKn: clampNumber(
      c.routeDraftCruiseSpeedKn, MIN_CRUISE_SPEED_KN, MAX_CRUISE_SPEED_KN, DEFAULT_CRUISE_SPEED_KN
    ),
    routeDraftBurnLitersPerHour: clampNumber(
      c.routeDraftBurnLitersPerHour, MIN_BURN_LITERS_PER_HOUR, MAX_BURN_LITERS_PER_HOUR, DEFAULT_BURN_LITERS_PER_HOUR
    ),
    routeDraftReservePercent: clampNumber(
      c.routeDraftReservePercent, MIN_RESERVE_PERCENT, MAX_RESERVE_PERCENT, DEFAULT_RESERVE_PERCENT
    ),
    routeDraftStandoffNm: clampNumber(
      c.routeDraftStandoffNm, MIN_STANDOFF_NM, MAX_STANDOFF_NM, DEFAULT_STANDOFF_NM
    ),
    routeDraftMaxLegNm: clampNumber(
      c.routeDraftMaxLegNm, MIN_MAX_LEG_NM, MAX_MAX_LEG_NM, DEFAULT_MAX_LEG_NM
    )
  }
}

/**
 * The route-draft config-schema fragment, merged into the plugin schema by
 * `assemblePluginSchema` in `plugin.ts`. Every top-level key is namespaced
 * `routeDraft*` so it cannot collide with an input or output module key (the
 * assembler throws on a duplicate). The numeric fields delegate to
 * `boundedNumberSchema`, so the schema bounds and the panel bounds are the one
 * set of values from this module.
 */
export function routeDraftConfigSchema (): Record<string, unknown> {
  return {
    routeDraftEnabled: {
      type: 'boolean',
      title: 'Enable AI route drafting (admin only, spends the OpenRouter budget)',
      default: false
    },
    routeDraftOpenRouterApiKey: {
      type: 'string',
      title: 'OpenRouter API key (stored unencrypted in the plugin config)',
      format: 'password',
      default: ''
    },
    routeDraftModel: {
      type: 'string',
      title: 'OpenRouter model slug',
      default: DEFAULT_ROUTE_DRAFT_MODEL
    },
    routeDraftMaxCallsPerDay: boundedNumberSchema(
      'Maximum drafting calls per day, including failed attempts (bounds calls, not dollars)',
      DEFAULT_MAX_CALLS_PER_DAY, MIN_MAX_CALLS_PER_DAY, MAX_MAX_CALLS_PER_DAY, true
    ),
    routeDraftPropulsion: {
      type: 'string',
      title: 'Vessel propulsion',
      enum: PROPULSION_CHOICES.map((choice) => choice.value),
      default: DEFAULT_PROPULSION
    },
    routeDraftDraftMeters: boundedNumberSchema(
      'Vessel draft, in meters (0 to read design.draft from the data model)',
      DEFAULT_DRAFT_METERS, MIN_DRAFT_METERS, MAX_DRAFT_METERS
    ),
    routeDraftSafetyMarginMeters: boundedNumberSchema(
      'Depth safety margin added to the draft, in meters',
      DEFAULT_SAFETY_MARGIN_METERS, MIN_SAFETY_MARGIN_METERS, MAX_SAFETY_MARGIN_METERS
    ),
    routeDraftTackingAngleDeg: boundedNumberSchema(
      'Closest-hauled tacking angle, in degrees off the true wind',
      DEFAULT_TACKING_ANGLE_DEG, MIN_TACKING_ANGLE_DEG, MAX_TACKING_ANGLE_DEG
    ),
    routeDraftCruiseSpeedKn: boundedNumberSchema(
      'Cruise speed under power, in knots (0 disables the fuel estimate)',
      DEFAULT_CRUISE_SPEED_KN, MIN_CRUISE_SPEED_KN, MAX_CRUISE_SPEED_KN
    ),
    routeDraftBurnLitersPerHour: boundedNumberSchema(
      'Fuel burn at cruise, in liters per hour (0 disables the fuel estimate)',
      DEFAULT_BURN_LITERS_PER_HOUR, MIN_BURN_LITERS_PER_HOUR, MAX_BURN_LITERS_PER_HOUR
    ),
    routeDraftReservePercent: boundedNumberSchema(
      'Fuel reserve held back, as a percent of fuel aboard',
      DEFAULT_RESERVE_PERCENT, MIN_RESERVE_PERCENT, MAX_RESERVE_PERCENT
    ),
    routeDraftStandoffNm: boundedNumberSchema(
      'Standoff kept off charted land, in nautical miles',
      DEFAULT_STANDOFF_NM, MIN_STANDOFF_NM, MAX_STANDOFF_NM
    ),
    routeDraftMaxLegNm: boundedNumberSchema(
      'Longest leg before the model is asked to add a turning waypoint, in nautical miles',
      DEFAULT_MAX_LEG_NM, MIN_MAX_LEG_NM, MAX_MAX_LEG_NM
    )
  }
}
