/**
 * UI metadata for the ActiveCaptain POI-type section of the configuration
 * panel: the four labeled groups and the human-readable label for each toggle.
 * Every flag is one of the includeX booleans on PluginConfig, so all 13
 * ActiveCaptain POI types appear exactly once across the groups.
 */

import type { PoiTypeFlag } from '../shared/types.js'

/** A single POI-type toggle: its PluginConfig flag and its display label. */
export interface ActiveCaptainPoiTypeOption {
  flag: PoiTypeFlag
  label: string
}

/** A labeled group of related ActiveCaptain POI-type toggles. */
export interface ActiveCaptainPoiTypeGroup {
  title: string
  options: readonly ActiveCaptainPoiTypeOption[]
}

/** The four ActiveCaptain POI-type groups, in display order. */
export const ACTIVE_CAPTAIN_POI_TYPE_GROUPS = [
  {
    title: 'Berthing and services',
    options: [
      { flag: 'includeMarinas', label: 'Marinas' },
      { flag: 'includeAnchorages', label: 'Anchorages' },
      { flag: 'includeBoatRamps', label: 'Boat ramps' },
      { flag: 'includeBusinesses', label: 'Businesses' }
    ]
  },
  {
    title: 'Navigation and hazards',
    options: [
      { flag: 'includeHazards', label: 'Hazards' },
      { flag: 'includeInlets', label: 'Inlets' },
      { flag: 'includeNavigational', label: 'Navigational aids' }
    ]
  },
  {
    title: 'Infrastructure',
    options: [
      { flag: 'includeBridges', label: 'Bridges' },
      { flag: 'includeDams', label: 'Dams' },
      { flag: 'includeFerries', label: 'Ferries' },
      { flag: 'includeLocks', label: 'Locks' }
    ]
  },
  {
    title: 'Other',
    options: [
      { flag: 'includeLocalKnowledge', label: 'Local knowledge' },
      { flag: 'includeAirports', label: 'Airports' }
    ]
  }
] as const satisfies readonly ActiveCaptainPoiTypeGroup[]

/**
 * The flag set covered by ACTIVE_CAPTAIN_POI_TYPE_GROUPS, derived from the
 * literal `as const` shape above. The exhaustiveness check below uses it.
 */
type GroupedFlag = typeof ACTIVE_CAPTAIN_POI_TYPE_GROUPS[number]['options'][number]['flag']

/**
 * Compile-time guard that the grouped UI list covers every PoiTypeFlag
 * exactly. Adding a flag to PluginConfig without listing it in a group, or
 * listing a flag here that PluginConfig does not carry, makes this fail.
 */
type AssertExhaustive =
  Exclude<PoiTypeFlag, GroupedFlag> extends never
    ? Exclude<GroupedFlag, PoiTypeFlag> extends never ? true : 'extra flag in panel groups'
    : 'PoiTypeFlag missing from panel groups'
export const ACTIVE_CAPTAIN_POI_TYPE_GROUPS_EXHAUSTIVE_WITNESS: AssertExhaustive = true
