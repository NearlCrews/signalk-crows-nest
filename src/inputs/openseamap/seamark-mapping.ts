/**
 * OpenSeaMap seamark-type mapping.
 *
 * OpenSeaMap tags marine features with OpenStreetMap's `seamark:type` key.
 * This module maps those raw values onto the plugin's existing `PoiType`
 * union, so an OpenSeaMap feature flows through the same outputs (the `notes`
 * resource, the proximity alarm, and the route-corridor scan) as an
 * ActiveCaptain point of interest. The `PoiType` union is not extended: every
 * seamark value maps to an existing member.
 *
 * It also defines the seamark groups the configuration panel exposes as a
 * checklist, and builds the alternation regex the Overpass query filters on.
 */

import type { PoiType } from '../../shared/types.js'

/**
 * Map a `seamark:type` value onto a `PoiType`. `rock`, `wreck`, and
 * `obstruction` become `Hazard`, so they flow into the existing proximity and
 * route-corridor alarms. An unrecognized value maps to `Unknown`.
 */
const SEAMARK_POI_TYPE: Readonly<Record<string, PoiType>> = {
  rock: 'Hazard',
  wreck: 'Hazard',
  obstruction: 'Hazard',
  harbour: 'Marina',
  marina: 'Marina',
  lock_basin: 'Lock',
  bridge: 'Bridge',
  light_major: 'Navigational',
  light_minor: 'Navigational',
  light_float: 'Navigational',
  light_vessel: 'Navigational',
  landmark: 'Navigational',
  beacon_lateral: 'Navigational',
  beacon_cardinal: 'Navigational',
  beacon_isolated_danger: 'Navigational',
  beacon_safe_water: 'Navigational',
  beacon_special_purpose: 'Navigational',
  buoy_lateral: 'Navigational',
  buoy_cardinal: 'Navigational',
  buoy_isolated_danger: 'Navigational',
  buoy_safe_water: 'Navigational',
  buoy_special_purpose: 'Navigational',
  anchorage: 'Anchorage',
  anchor_berth: 'Anchorage',
  mooring: 'Anchorage'
}

/** Map a `seamark:type` value to a `PoiType`, defaulting to `Unknown`. */
export function seamarkToPoiType (value: string): PoiType {
  return SEAMARK_POI_TYPE[value] ?? 'Unknown'
}

/**
 * Resolve the `PoiType` for an OpenSeaMap element from its OSM tags. A
 * `seamark:type` tag is mapped directly; an element with no seamark type but
 * tagged `leisure=marina` is a `Marina`. Everything else is `Unknown`.
 */
export function elementPoiType (tags: Record<string, string>): PoiType {
  const seamark = tags['seamark:type']
  if (seamark !== undefined && seamark.length > 0) {
    return seamarkToPoiType(seamark)
  }
  if (tags.leisure === 'marina') {
    return 'Marina'
  }
  return 'Unknown'
}

/** One configurable group of seamark features the OpenSeaMap source fetches. */
export interface SeamarkGroup {
  /** Stable group id, stored in the plugin configuration. */
  id: string
  /** Human-readable label, shown in the configuration panel. */
  label: string
  /** The `seamark:type` values this group fetches. */
  seamarkTypes: readonly string[]
}

/**
 * The seamark groups the configuration panel exposes. A user enables groups
 * rather than individual seamark types; {@link seamarkRegex} turns the enabled
 * groups into the Overpass query filter.
 */
export const SEAMARK_GROUPS: readonly SeamarkGroup[] = [
  {
    id: 'hazards',
    label: 'Hazards',
    seamarkTypes: ['rock', 'wreck', 'obstruction']
  },
  {
    id: 'navaids',
    label: 'Navigation aids',
    seamarkTypes: [
      'light_major', 'light_minor', 'light_float', 'light_vessel', 'landmark',
      'beacon_lateral', 'beacon_cardinal', 'beacon_isolated_danger',
      'beacon_safe_water', 'beacon_special_purpose',
      'buoy_lateral', 'buoy_cardinal', 'buoy_isolated_danger',
      'buoy_safe_water', 'buoy_special_purpose'
    ]
  },
  {
    id: 'harbours',
    label: 'Harbours and moorings',
    seamarkTypes: ['harbour', 'anchorage', 'anchor_berth', 'mooring']
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    seamarkTypes: ['lock_basin', 'bridge']
  }
]

/**
 * Build the anchored alternation regex an Overpass `seamark:type` filter uses,
 * covering every seamark type in the enabled groups. An unknown group id is
 * ignored. With no enabled group the regex matches nothing, so the source
 * issues no seamark query rather than fetching every marine feature.
 */
export function seamarkRegex (groups: readonly string[]): string {
  const enabled = new Set(groups)
  const types: string[] = []
  for (const group of SEAMARK_GROUPS) {
    if (enabled.has(group.id)) {
      types.push(...group.seamarkTypes)
    }
  }
  return `^(${types.join('|')})$`
}
