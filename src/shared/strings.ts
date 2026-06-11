/**
 * String-narrowing helper shared across the wire parsers.
 *
 * The USCG Light List and NOAA ENC Direct feeds both ship absent text fields
 * as explicit `null`s, empty strings, or whitespace-only strings. One shared
 * reader keeps the "absent" semantics identical across the inputs, so a
 * blank-looking wire value can never survive as a visible title or label in
 * one source while the other treats it as missing.
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
