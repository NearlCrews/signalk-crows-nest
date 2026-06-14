/**
 * Number-narrowing helpers shared across the plugin.
 *
 * Several modules need to narrow an `unknown` value off the wire or off the
 * SignalK data model into a finite `number`. A single helper avoids the slight
 * semantic drift that three separate ad-hoc copies were starting to pick up.
 *
 * The "not usable" sentinel is `null` across every helper here, matching the
 * `toPosition` and `resolvePosition`/`resolveExplicitBbox` returns elsewhere.
 * The `null ?? DEFAULT` idiom still works for the input-module config call
 * sites that prefer the optional-default pattern.
 */

/**
 * Narrow an unknown value into a finite `number`, or return `null` when it is
 * not. `NaN`, `Infinity`, and `-Infinity` all fail the check, so a downstream
 * consumer can assume a returned value is genuinely usable.
 */
export function toFiniteNumber (value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Narrow an unknown value into a finite `number`, or `undefined` when it is
 * not. The `undefined` twin of {@link toFiniteNumber}, for the wire parsers
 * whose record shapes use optional fields rather than `null` sentinels.
 */
export function finiteOrUndefined (value: unknown): number | undefined {
  return toFiniteNumber(value) ?? undefined
}

/**
 * Type-guard form of {@link toFiniteNumber}: true when `value` is a finite
 * number, narrowing it to `number`. The boolean twin for the request and wire
 * validators that branch on finiteness rather than reading the value out, so a
 * caller does not hand-roll `typeof x === 'number' && Number.isFinite(x)`.
 */
export function isFiniteNumber (value: unknown): value is number {
  return toFiniteNumber(value) !== null
}

/**
 * Narrow an unknown value into a strictly positive finite `number`, or
 * return `null` when it is not. The three input modules' optional
 * config-key validators all want this exact shape (a positive merge
 * radius, never zero or negative): a non-positive value means "fall back
 * to the source's default" rather than "off."
 */
export function positiveFiniteNumber (value: unknown): number | null {
  const finite = toFiniteNumber(value)
  return finite !== null && finite > 0 ? finite : null
}

/**
 * Clamp a raw value into `[min, max]`, falling back to `fallback` when it is
 * not a finite number, and optionally truncating to an integer. The config
 * bounds modules (rating, year-filter, bbox-debounce, bridge-clearance) share
 * this body while each keeps its own bounds and default, so the clamp logic
 * lives in one place.
 */
export function clampNumber (
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
  truncate = false
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  let value = raw
  if (value < min) value = min
  else if (value > max) value = max
  return truncate ? Math.trunc(value) : value
}

/**
 * Round a value to a fixed number of decimals. Shared by the bridge-clearance
 * message formatter and the panel's display-unit conversions, so the
 * power-of-ten dance lives once.
 */
export function roundTo (value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Resolve an optional positive numeric config value: a non-positive or
 * non-numeric value falls back to `fallback` (matching the
 * {@link positiveFiniteNumber} optional-default idiom), and a usable value is
 * capped at `max`. The bounded config-key modules (cache-duration,
 * proximity-radius, route-corridor) delegate here so the
 * fallback-then-cap policy lives once, the way {@link clampNumber} holds the
 * clamp-into-range policy.
 */
export function positiveCappedNumber (raw: unknown, max: number, fallback: number): number {
  const value = positiveFiniteNumber(raw) ?? fallback
  return Math.min(value, max)
}

/** True when `value` is a finite latitude in the standard `[-90, 90]` range. */
export function isValidLatitude (value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
}

/** True when `value` is a finite longitude in the standard `[-180, 180]` range. */
export function isValidLongitude (value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
}

/**
 * Lenient truthy interpretation for wire boolean fields that may arrive as
 * `'1'`, `1`, `'true'`, or `true`. Every other value (including the empty
 * string, `'0'`, and `null`) is treated as false. The USCG Light List
 * `INACTIVE` field is the motivating case: the upstream schema describes it
 * as a string but a future schema bump could ship the boolean as a number
 * without warning.
 */
export function isWireTruthy (value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    return trimmed === '1' || trimmed === 'true'
  }
  return false
}
