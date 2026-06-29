/**
 * String-narrowing helper shared across the wire parsers and the panel.
 *
 * The USCG Light List and NOAA ENC Direct feeds both ship absent text fields
 * as explicit `null`s, empty strings, or whitespace-only strings, and the
 * panel's unit-preferences reader narrows the preset name off the
 * applicationData document the same way. One shared reader keeps the
 * "absent" semantics identical across consumers, so a blank-looking value
 * can never survive as a visible title, a label, or a fetchable preset name.
 */

/**
 * Return the trimmed string when `value` is a string with non-blank content,
 * otherwise `undefined`.
 */
export function presentString (value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Uppercase the first character of `value` and leave the rest unchanged, the
 * sentence-case touch shared by the OpenSeaMap detail renderer and other
 * display helpers. An empty string is returned unchanged.
 */
export function capitalizeFirst (value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
