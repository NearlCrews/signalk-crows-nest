/**
 * HTML escape helper shared across the source detail renderers.
 *
 * Each source's detail renderer interpolates wire strings into HTML. The
 * escape table covers every metacharacter that has special meaning in
 * attribute or text contexts: `&`, `<`, `>`, `"`, and `'`. The apostrophe is
 * not strictly required for any of today's interpolation sites (every
 * attribute uses double quotes), but the helper is a shared boundary and
 * the next attribute that switches to single quotes inherits the right
 * behavior automatically.
 */

import { formatMeters } from './format-meters.js'

const ESCAPE_TABLE: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;']
])

const ESCAPE_REGEX = /[&<>"']/g

/** Escape a string for safe interpolation into an HTML attribute or text node. */
export function escapeHtml (value: string): string {
  // ESCAPE_REGEX matches exactly the five keys in ESCAPE_TABLE, so the lookup
  // is total: the non-null assertion documents that the table covers the regex.
  return value.replace(ESCAPE_REGEX, (char) => ESCAPE_TABLE.get(char) as string)
}

/**
 * Render a labelled paragraph: `<p><strong>Label:</strong> value.</p>` with
 * both the label and the value HTML-escaped. The structured detail renderers
 * (NOAA ENC, OpenSeaMap, USCG Light List) each build a run of these lines, so
 * the one period-terminated shape lives here. A line that omits the trailing
 * period or interpolates non-string content (a formatted depth, a composite
 * source line) stays bespoke at its call site.
 */
export function labeledParagraph (label: string, value: string): string {
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}.</p>`
}

/**
 * Render a labelled metric line: `<p><strong>Label:</strong> X.X m.</p>` with
 * the value formatted to one decimal in meters. The USACE and World Port Index
 * renderers each build this exact metric-paragraph shape, so it lives here once;
 * each caller does its own wire parsing and unit conversion before handing the
 * meters in.
 */
export function labeledMeters (label: string, meters: number): string {
  return `<p><strong>${escapeHtml(label)}:</strong> ${formatMeters(meters)} m.</p>`
}
