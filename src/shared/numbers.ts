/**
 * Number-narrowing helpers shared across the plugin.
 *
 * Several modules need to narrow an `unknown` value off the wire or off the
 * SignalK data model into a finite `number`. A single helper avoids the slight
 * semantic drift that three separate ad-hoc copies were starting to pick up.
 */

/**
 * Narrow an unknown value into a finite `number`, or return `null` when it is
 * not. `NaN`, `Infinity`, and `-Infinity` all fail the check, so a downstream
 * consumer can assume a returned value is genuinely usable.
 */
export function toFiniteNumber (value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
