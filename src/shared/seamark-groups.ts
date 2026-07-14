/**
 * OpenSeaMap seamark group ids and labels, the single source of truth.
 *
 * Three places need the same list of seamark groups: the OpenSeaMap input
 * (`src/inputs/openseamap/seamark-mapping.ts`, which adds the per-group
 * `seamark:type` values used to build the Overpass query), the OpenSeaMap
 * input's plugin-config schema fragment (which uses the ids as the admin-UI
 * enum and default), and the configuration panel (which renders the labels in
 * a checklist). Each of those modules imports its view from here, so adding,
 * renaming, or removing a group is a one-line edit that updates every site.
 *
 * Labels are the canonical short form. The panel may render longer descriptive
 * labels alongside; either way, the ids are the single source of truth.
 */

/** One seamark group's stable id and its display label. */
export interface SeamarkGroupRef {
  /** Stable id, stored in the plugin configuration. */
  id: string
  /** Human-readable label. */
  label: string
}

/**
 * The seamark groups the OpenSeaMap source exposes, in display order. The id
 * is what `openSeaMapSeamarkGroups` stores and what the Overpass query filter
 * is built from.
 */
export const SEAMARK_GROUP_REFS: readonly SeamarkGroupRef[] = [
  { id: 'hazards', label: 'Hazards' },
  { id: 'navaids', label: 'Navigation aids' },
  { id: 'harbours', label: 'Harbours and moorings' },
  { id: 'infrastructure', label: 'Infrastructure' }
]

/** Every seamark group id, in display order. */
export const SEAMARK_GROUP_IDS: readonly string[] = SEAMARK_GROUP_REFS.map((group) => group.id)

/** Known ids for fast validation of persisted or externally supplied config. */
const SEAMARK_GROUP_ID_SET: ReadonlySet<string> = new Set(SEAMARK_GROUP_IDS)

/**
 * Normalize an untyped group selection. An omitted or non-array value keeps
 * the backward-compatible all-groups default; an explicit array preserves
 * order while dropping non-strings and unknown ids, including an intentional
 * empty selection.
 */
export function normalizeSeamarkGroupIds (raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...SEAMARK_GROUP_IDS]
  return raw.filter(
    (group): group is string => typeof group === 'string' && SEAMARK_GROUP_ID_SET.has(group)
  )
}
