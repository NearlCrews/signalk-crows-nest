/**
 * SignalK `notes` resource builder.
 *
 * Pure helpers that turn a point of interest into a SignalK `notes` resource
 * object and read a dot-notation property path back out of one. The shape is
 * shared by the list and single-resource responses.
 */

import { PLUGIN_ID } from '../../shared/plugin-id.js'
import type { Position } from '../../shared/types.js'

/** Inputs for {@link buildNoteResource}. */
export interface NoteResourceInput {
  /** Display name shown on the chart marker. */
  name: string
  /** Map position. */
  position: Position
  /** SignalK icon hint; the lowercased POI type. */
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
  /** Rendered HTML description (text/html). Omitted when none. */
  description?: string
}

/**
 * Build a SignalK `notes` resource object. The shape is shared by the list and
 * single-resource responses.
 */
export function buildNoteResource (input: NoteResourceInput): Record<string, unknown> {
  const { name, position, skIcon, url, source, attribution, sources, timestamp, description } = input
  const properties: Record<string, unknown> = { readOnly: true, skIcon, source, attribution }
  // More than one contributing source is a corroboration signal: the same
  // physical feature was reported independently by each listed source.
  if (sources !== undefined && sources.length > 1) {
    properties.sources = sources
    properties.sourceCount = sources.length
  }
  const note: Record<string, unknown> = {
    name,
    position,
    url,
    properties,
    $source: PLUGIN_ID
  }
  if (timestamp !== undefined) {
    note.timestamp = timestamp
  }
  if (description !== undefined) {
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
