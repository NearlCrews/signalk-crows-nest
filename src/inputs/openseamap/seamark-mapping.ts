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

import { SEAMARK_GROUP_REFS, type SeamarkGroupRef } from '../../shared/seamark-groups.js'
import type { PoiType } from '../../shared/types.js'

/**
 * Single mapping from a `seamark:type` value to its `PoiType`, its Freeboard-SK
 * note icon, and its plain-English label. One table keeps the three in
 * lockstep: a new seamark type is one row here, not three parallel edits across
 * this file and openseamap-detail.ts.
 *
 * `rock`, `wreck`, and `obstruction` become `Hazard`, so they flow into the
 * existing proximity and route-corridor alarms; an unrecognized value maps to
 * `Unknown` (see the readers below). Freeboard registers a fixed set of POI
 * icons under the `sk-` namespace, so an unregistered icon name silently falls
 * back to a default yellow square; every icon here is one Freeboard actually
 * registers. Isolated-danger buoys and beacons carry the `hazard` glyph because
 * their whole purpose is to flag a danger, yet their `PoiType` stays
 * `Navigational` so they do not falsely trigger the proximity alarms:
 * decoupling the icon from the type is what makes that possible.
 */
const SEAMARK_MAPPING: Readonly<Record<string, { type: PoiType, icon: string, label: string }>> = {
  rock: { type: 'Hazard', icon: 'hazard', label: 'Rock' },
  wreck: { type: 'Hazard', icon: 'hazard', label: 'Wreck' },
  obstruction: { type: 'Hazard', icon: 'hazard', label: 'Obstruction' },
  harbour: { type: 'Marina', icon: 'marina', label: 'Harbour' },
  marina: { type: 'Marina', icon: 'marina', label: 'Marina' },
  lock_basin: { type: 'Lock', icon: 'lock', label: 'Lock' },
  bridge: { type: 'Bridge', icon: 'bridge', label: 'Bridge' },
  light_major: { type: 'Navigational', icon: 'navigation-structure', label: 'Major light' },
  light_minor: { type: 'Navigational', icon: 'navigation-structure', label: 'Minor light' },
  light_float: { type: 'Navigational', icon: 'navigation-structure', label: 'Light float' },
  light_vessel: { type: 'Navigational', icon: 'navigation-structure', label: 'Light vessel' },
  landmark: { type: 'Navigational', icon: 'navigation-structure', label: 'Landmark' },
  beacon_lateral: { type: 'Navigational', icon: 'navigation-structure', label: 'Lateral beacon' },
  beacon_cardinal: { type: 'Navigational', icon: 'navigation-structure', label: 'Cardinal beacon' },
  beacon_isolated_danger: { type: 'Navigational', icon: 'hazard', label: 'Isolated-danger beacon' },
  beacon_safe_water: { type: 'Navigational', icon: 'navigation-structure', label: 'Safe-water beacon' },
  beacon_special_purpose: { type: 'Navigational', icon: 'navigation-structure', label: 'Special-purpose beacon' },
  buoy_lateral: { type: 'Navigational', icon: 'navigation-structure', label: 'Lateral buoy' },
  buoy_cardinal: { type: 'Navigational', icon: 'navigation-structure', label: 'Cardinal buoy' },
  buoy_isolated_danger: { type: 'Navigational', icon: 'hazard', label: 'Isolated-danger buoy' },
  buoy_safe_water: { type: 'Navigational', icon: 'navigation-structure', label: 'Safe-water buoy' },
  buoy_special_purpose: { type: 'Navigational', icon: 'navigation-structure', label: 'Special-purpose buoy' },
  anchorage: { type: 'Anchorage', icon: 'anchorage', label: 'Anchorage' },
  anchor_berth: { type: 'Anchorage', icon: 'anchorage', label: 'Anchor berth' },
  mooring: { type: 'Anchorage', icon: 'anchorage', label: 'Mooring' }
}

/** Generic fallback icon, used when no specific Freeboard icon fits. */
const FALLBACK_SK_ICON = 'notice-to-mariners'

/** Plain-English label for a `seamark:type` value, or undefined when unmapped. */
export function seamarkLabel (value: string): string | undefined {
  return SEAMARK_MAPPING[value]?.label
}

/**
 * Resolve both the `PoiType` and the Freeboard-SK note icon for an OpenSeaMap
 * element in a single pass over its OSM tags. A `seamark:type` tag drives both
 * mappings; an element with no seamark type but tagged `leisure=marina` is a
 * `Marina` with the `marina` icon; everything else is `Unknown` with the
 * generic notice glyph, so a missing icon never renders as a bare yellow
 * square. The list and detail builders call this once per element so the
 * seamark value is normalized only a single time.
 */
export function elementMarking (tags: Record<string, string>): { type: PoiType, skIcon: string } {
  const seamark = tags['seamark:type']?.trim().toLowerCase()
  if (seamark !== undefined && seamark.length > 0) {
    const mapping = SEAMARK_MAPPING[seamark]
    return { type: mapping?.type ?? 'Unknown', skIcon: mapping?.icon ?? FALLBACK_SK_ICON }
  }
  if (tags.leisure?.trim().toLowerCase() === 'marina') {
    return { type: 'Marina', skIcon: 'marina' }
  }
  return { type: 'Unknown', skIcon: FALLBACK_SK_ICON }
}

/**
 * One configurable group of seamark features the OpenSeaMap source fetches.
 * Extends the shared {@link SeamarkGroupRef} with the per-group
 * `seamark:type` values used to build the Overpass query.
 */
export interface SeamarkGroup extends SeamarkGroupRef {
  /** The `seamark:type` values this group fetches. */
  seamarkTypes: readonly string[]
}

/** Per-group `seamark:type` values, keyed by the shared group id. */
const SEAMARK_TYPES_BY_GROUP: Readonly<Record<string, readonly string[]>> = {
  hazards: ['rock', 'wreck', 'obstruction'],
  navaids: [
    'light_major', 'light_minor', 'light_float', 'light_vessel', 'landmark',
    'beacon_lateral', 'beacon_cardinal', 'beacon_isolated_danger',
    'beacon_safe_water', 'beacon_special_purpose',
    'buoy_lateral', 'buoy_cardinal', 'buoy_isolated_danger',
    'buoy_safe_water', 'buoy_special_purpose'
  ],
  harbours: ['harbour', 'anchorage', 'anchor_berth', 'mooring'],
  infrastructure: ['lock_basin', 'bridge']
}

/**
 * The seamark groups the OpenSeaMap source fetches. The id and label come from
 * the shared {@link SEAMARK_GROUP_REFS}; {@link seamarkRegex} turns the
 * enabled-group ids into the Overpass query filter.
 */
export const SEAMARK_GROUPS: readonly SeamarkGroup[] = SEAMARK_GROUP_REFS.map((ref) => ({
  ...ref,
  seamarkTypes: SEAMARK_TYPES_BY_GROUP[ref.id] ?? []
}))

/**
 * Build the anchored alternation regex an Overpass `seamark:type` filter uses,
 * covering every seamark type in the enabled groups. An unknown group id is
 * ignored. With no enabled group `types` is empty, so the regex is `^()$`,
 * which matches only the empty string: real `seamark:type` values are never
 * empty, so the filter matches no seamark feature. The list query is still
 * issued, since it also fetches `leisure=marina` elements outside the seamark
 * filter.
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
