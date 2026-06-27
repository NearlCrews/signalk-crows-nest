/**
 * Normalized point-of-interest detail schema.
 *
 * A source-agnostic, presentation-neutral structure for the rich per-source
 * detail a chartplotter shows when a marker is opened. It is "the popup, as
 * data": a list of titled sections, each a list of labeled items, so a modern
 * client (for example signalk-binnacle) can render the detail natively rather
 * than parse the rendered HTML description.
 *
 * Delivery is ADDITIVE, not a format switch. The note keeps its standard
 * SignalK shape (name, position, the rendered `description` HTML, and the
 * existing `properties`), and this structure rides ALONGSIDE under
 * `properties.crowsNest`. A generic notes consumer (stock Freeboard-SK)
 * ignores the extra property and renders the HTML; a structured consumer reads
 * `properties.crowsNest.sections` and ignores the HTML. Nothing breaks, and the
 * two coexist without a server-wide toggle.
 *
 * Each source builds its own sections (the data models are heterogeneous: a
 * marina's amenities, a light's characteristic, a wreck's sounding), but the
 * sections/items shape is uniform, so the consumer renders one shape.
 */

/**
 * A hint for how a client should present an item's value. Optional: a client
 * that does not special-case a kind can always fall back to showing the value
 * as text.
 *
 * - `text`    a plain string value.
 * - `measure` a numeric quantity with a `unit` (e.g. 5 NM, 12 ft, 19.8 m).
 * - `count`   a whole-number tally (berths, reviews).
 * - `availability` a yes/no/nearby capability (rendered as a tick, cross, or pin).
 * - `flag`    a boolean property (free vs paid, active vs inactive).
 * - `rating`  a 0-to-5 review score.
 * - `link`    a URL the client may render as an anchor.
 * - `note`    free-text prose, possibly multi-line.
 */
export type NormalizedItemKind =
  | 'text'
  | 'measure'
  | 'count'
  | 'availability'
  | 'flag'
  | 'rating'
  | 'link'
  | 'note'

/** One labeled value within a section. */
export interface NormalizedItem {
  /** Human-readable label, e.g. "Nominal range" or "Diesel". */
  label: string
  /** The value. A `measure` carries the number here and its unit in `unit`. */
  value: string | number | boolean
  /** Presentation hint; absent means render as text. */
  kind?: NormalizedItemKind
  /** Unit for a `measure` value, e.g. "NM", "ft", "m". */
  unit?: string
}

/** A titled group of related items. */
export interface NormalizedSection {
  /** Stable machine id, e.g. "light", "fuel", "remarks". */
  id: string
  /** Human-readable section heading, e.g. "Light" or "Fuel". */
  title: string
  /** The items in this section. A section is omitted entirely when it has none. */
  items: NormalizedItem[]
}

/**
 * Schema version of the `properties.crowsNest` blob. Bumped on a
 * backwards-incompatible change so a consumer can detect and adapt; a consumer
 * that does not recognize the version can fall back to the HTML description.
 */
export const NORMALIZED_DETAIL_SCHEMA_VERSION = 1

/**
 * Append a section to `sections` when it carries at least one item. Every
 * per-source builder uses this so an all-absent section (a daymark-only aid's
 * "Light", a marina with no fuel data) is dropped rather than shown as an empty
 * heading.
 */
export function pushSection (
  sections: NormalizedSection[],
  id: string,
  title: string,
  items: NormalizedItem[]
): void {
  if (items.length > 0) {
    sections.push({ id, title, items })
  }
}
