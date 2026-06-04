/**
 * URL-scheme allowlist guard, shared by every renderer that emits an
 * attacker-influenced value as a clickable link.
 *
 * A wire value like `javascript:alert(1)` auto-escapes safely as visible text,
 * but it becomes click-to-execute the moment a renderer puts it in an `href`
 * (in HTML) or emits it as a `link` item a structured client renders as an
 * anchor. Both the Handlebars detail templates and the normalized-detail
 * section builders route their link values through this one guard so the HTML
 * and the structured output cannot diverge on which schemes are allowed.
 */

/** Schemes a link value may use. Anything else (notably `javascript:`) is rejected. */
const DEFAULT_ALLOWED_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:']

/**
 * Return `value` when it parses as an absolute URL whose scheme is in
 * `allowedSchemes`, otherwise `undefined`. A non-string, an empty string, an
 * unparseable value, or a disallowed scheme (for example `javascript:`,
 * `data:`, or `vbscript:`) all yield `undefined` so the caller drops the link
 * rather than shipping a click-to-execute href. The scheme comparison is
 * case-insensitive, matching how a browser resolves `JavaScript:`.
 */
export function safeLinkUrl (
  value: unknown,
  allowedSchemes: readonly string[] = DEFAULT_ALLOWED_SCHEMES
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  try {
    const protocol = new URL(value).protocol.toLowerCase()
    return allowedSchemes.includes(protocol) ? value : undefined
  } catch {
    return undefined
  }
}
