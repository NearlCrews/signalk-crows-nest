/**
 * String helpers shared across the wire parsers, the plugin, and the panel.
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

/**
 * Join `items` with commas and a final "and", serial comma included.
 *
 * Written once because several surfaces need it and would otherwise each get
 * the punctuation slightly wrong: the panel's collapsed Alerts summary naming
 * the armed alarms, its collapsed source summaries naming their layers, its
 * fallback-endpoint error naming the unusable lines, and the plugin's own
 * operator-facing messages. Three or more items take the serial comma, two
 * take a bare "and", and one is itself.
 *
 * Not `Intl.ListFormat`. The serial comma is a house rule rather than a
 * locale's preference, so it belongs pinned by a test this repository owns
 * rather than left to whatever ICU data the runtime happens to carry. And
 * `Intl.ListFormat` wants a locale argument, for which neither the plugin nor
 * the panel has a story.
 */
export function joinWords (items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
