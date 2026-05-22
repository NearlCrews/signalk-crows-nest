/**
 * UI metadata for the OpenSeaMap section of the configuration panel: the four
 * seamark feature groups the OpenSeaMap source can import, each with the id
 * stored in `openSeaMapSeamarkGroups` and a human-readable label. The ids match
 * the seamark groups defined by the OpenSeaMap input under
 * `src/inputs/openseamap/`; keep the two in step.
 */

/** A single OpenSeaMap seamark group: its config id and its display label. */
export interface SeamarkGroupOption {
  id: string
  label: string
}

/** The four OpenSeaMap seamark feature groups, in display order. */
export const SEAMARK_GROUPS: readonly SeamarkGroupOption[] = [
  { id: 'hazards', label: 'Hazards (rocks, wrecks, obstructions)' },
  { id: 'navaids', label: 'Navigational aids (lights, buoys, beacons)' },
  { id: 'harbours', label: 'Harbours and marinas' },
  { id: 'infrastructure', label: 'Infrastructure (locks, bridges)' }
]

/** The seamark group ids, in display order. */
export const SEAMARK_GROUP_IDS: readonly string[] = SEAMARK_GROUPS.map((group) => group.id)
