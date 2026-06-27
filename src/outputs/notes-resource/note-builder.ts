/**
 * SignalK `notes` resource builder.
 *
 * Pure helpers that turn a point of interest into a SignalK `notes` resource
 * object and read a dot-notation property path back out of one. The shape is
 * shared by the list and single-resource responses.
 *
 * Schema notes worth carrying:
 *
 * - `name` is the marker's display string. The legacy `Note` interface
 *   (resourcetypes.d.ts) uses `name`; the newer typebox `NoteBaseModel`
 *   schema uses `title` and defaults `additionalProperties` to false. The
 *   plugin follows the legacy `name` form because that is what Freeboard-SK
 *   currently consumes. If a strict server-side validator begins enforcing
 *   the typebox schema, this is the field that would need to be aliased.
 * - `url` is the external web page for the POI (the source-specific viewer).
 *   `href` is reserved by SignalK for chaining notes to other SignalK
 *   resources and is intentionally never set.
 * - `$source` is the plugin id (`signalk-crows-nest`), matching the SignalK
 *   convention that resource provenance is the producing plugin. The
 *   originating POI source slug rides on `properties.source` instead, so a
 *   client filtering "which upstream service produced this" reads
 *   `properties.source`, not `$source`.
 * - `properties.source` (singular) is the producing source's slug; for a
 *   dedupe-merged base POI it is the base source's slug. `properties.sources`
 *   (plural) is the full corroboration list, present only when more than one
 *   source contributed. The names differ by one letter on purpose: each
 *   means a different thing.
 * - `properties.plugin` and `properties.pluginRepo` ride on every note so a
 *   chartplotter UI can render a "plugin home" link from structured fields
 *   rather than depend on an inline footer in the description.
 * - `properties.crowsNest` (`{ schemaVersion, type, sections }`) carries the
 *   normalized detail a structured client renders natively, alongside the HTML
 *   `description` a generic client renders. Present only when the source
 *   produced sections. See `src/shared/normalized-detail.ts`.
 */

import { PLUGIN_ID, PLUGIN_REPO_URL } from '../../shared/plugin-id.js'
import { NORMALIZED_DETAIL_SCHEMA_VERSION } from '../../shared/normalized-detail.js'
import type { NormalizedSection } from '../../shared/normalized-detail.js'
import type { PoiType, Position } from '../../shared/types.js'

/** Inputs for {@link buildNoteResource}. */
export interface NoteResourceInput {
  /** Display name shown on the chart marker. */
  name: string
  /** Map position. */
  position: Position
  /** Freeboard `:sk-${icon}` hint, set explicitly by the producing source. */
  skIcon: string
  /** Public web page for this POI (source-specific). */
  url: string
  /** Source slug, e.g. `activecaptain` or `openseamap`. */
  source: string
  /** Human-readable attribution credit for the source. */
  attribution: string
  /**
   * Every source that corroborates this POI. More than one entry is a
   * confidence signal: the same physical feature was reported independently
   * by each listed source. Omitted on detail responses, which always route to
   * a single source.
   */
  sources?: string[]
  /**
   * ISO-8601 UTC last-modified time. Omitted when no genuine resource
   * timestamp is known: the list endpoint does not supply one.
   */
  timestamp?: string
  /** Rendered HTML description (text/html). Omitted when none or empty. */
  description?: string
  /**
   * POI type, published inside `properties.crowsNest` so a structured client
   * can style by type. Omitted on responses that carry no normalized detail.
   */
  type?: PoiType
  /**
   * Normalized, presentation-neutral detail. When present it is published under
   * `properties.crowsNest.sections` alongside the HTML `description`, so a
   * structured client renders it natively while a generic client renders the
   * HTML. Omitted by a source that does not yet produce it.
   */
  sections?: NormalizedSection[]
}

/**
 * Build a SignalK `notes` resource object. The shape is shared by the list and
 * single-resource responses.
 */
export function buildNoteResource (input: NoteResourceInput): Record<string, unknown> {
  const { name, position, skIcon, url, source, attribution, sources, timestamp, description, type, sections } = input
  // `readOnly` is intentionally NOT set in properties: it is not a standard
  // SignalK notes property and a strict server-side validator could strip
  // it. The read-only contract is enforced by the resource provider's
  // setResource/deleteResource methods, which reject every write.
  const properties: Record<string, unknown> = {
    skIcon,
    source,
    attribution,
    plugin: PLUGIN_ID,
    pluginRepo: PLUGIN_REPO_URL
  }
  // More than one contributing source is a corroboration signal: the same
  // physical feature was reported independently by each listed source.
  // `sourceCount` is intentionally not published: it is `sources.length`,
  // and publishing a derivable field invites the two to disagree silently.
  if (sources !== undefined && sources.length > 1) {
    properties.sources = sources
  }
  // Normalized detail rides alongside the HTML `description` under a single
  // namespaced blob: a structured client (signalk-binnacle) reads
  // `properties.crowsNest` and renders natively; a generic client (Freeboard-SK)
  // ignores it and renders the HTML. `schemaVersion` lets a consumer detect the
  // shape and fall back to the HTML on a version it does not recognize. The
  // blob carries `type` on both list and detail responses (so a marker can be
  // styled by POI type without a detail fetch) and `sections` only on detail
  // responses (the list omits the heavy per-POI detail). See
  // `src/shared/normalized-detail.ts`.
  if (type !== undefined || sections !== undefined) {
    const crowsNest: Record<string, unknown> = { schemaVersion: NORMALIZED_DETAIL_SCHEMA_VERSION }
    if (type !== undefined) crowsNest.type = type
    if (sections !== undefined) crowsNest.sections = sections
    properties.crowsNest = crowsNest
  }
  // Construct the position field-by-field rather than passing the source's
  // position object through unchanged. Two of the four sources hand us a
  // `{ ...spread }` clone of an upstream object, so a future upstream type
  // that grows a stray field (a geohash, a precision, a chart datum) would
  // otherwise propagate it onto the wire.
  const note: Record<string, unknown> = {
    name,
    position: { latitude: position.latitude, longitude: position.longitude },
    properties,
    $source: PLUGIN_ID
  }
  // Guard `url` against the empty string like `description` below: a defensive
  // source that returned `''` instead of a real link would otherwise ship
  // `url: ""`, and a chartplotter rendering a "more info" link from it lands
  // nowhere. Every current source supplies a real URL, so this only matters
  // defensively. `url` is optional on the SignalK `Note` interface.
  if (url.length > 0) {
    note.url = url
  }
  if (timestamp !== undefined) {
    note.timestamp = timestamp
  }
  // Tighten the description guard against empty strings: a defensive source
  // that returned `''` instead of `undefined` would otherwise ship a
  // `mimeType: text/html` for a body of length 0.
  if (description !== undefined && description.length > 0) {
    // The description is rendered HTML, so the note must declare text/html
    // rather than mislabel the markup as plain text.
    note.description = description
    note.mimeType = 'text/html'
  }
  return note
}

/** Read a dot-notation property path out of a note object. */
export function readProperty (note: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value !== null && typeof value === 'object') {
      return (value as Record<string, unknown>)[key]
    }
    return undefined
  }, note)
}
