/**
 * Shared JSON-schema fragment constructor for the plugin's bounded numeric
 * config fields. Every per-module schema builder (rating, year-filter,
 * bbox-debounce, refresh-hours, cache-duration, proximity-radius,
 * route-corridor, dedupe radius) delegates here, so the field shape lives in
 * one place: a future addition such as `description` or `multipleOf` lands in
 * every fragment at once instead of in some hand-rolled copies and not
 * others. Browser-safe (dependency-free) like the bounds modules that use it.
 */

/**
 * Build a bounded-number config-schema fragment. Pass `integer` for a field
 * that must be a whole number (the schema emits `type: 'integer'` so the admin
 * UI renders an integer input), otherwise the field is a plain number.
 */
export function boundedNumberSchema (
  title: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  integer = false
): Record<string, unknown> {
  return { type: integer ? 'integer' : 'number', title, default: defaultValue, minimum, maximum }
}
