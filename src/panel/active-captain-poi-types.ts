/**
 * UI metadata for the ActiveCaptain POI-type section of the configuration
 * panel: the four labeled groups and the human-readable label for each toggle.
 * Every flag is one of the includeX booleans on PluginConfig, so all 13
 * ActiveCaptain POI types appear exactly once across the groups.
 */

import type { PoiTypeFlag } from '../shared/types.js'

/** A single POI-type toggle: its PluginConfig flag and its display label. */
interface ActiveCaptainPoiTypeOption {
  flag: PoiTypeFlag
  label: string
}

/** A labeled group of related ActiveCaptain POI-type toggles. */
interface ActiveCaptainPoiTypeGroup {
  title: string
  options: readonly ActiveCaptainPoiTypeOption[]
}

/**
 * Keep the literal group shape while requiring it to cover every PoiTypeFlag.
 * The option constraint rejects unknown flags, and the conditional intersection
 * rejects a list that leaves any known flag out.
 */
function definePoiTypeGroups<const Groups extends readonly ActiveCaptainPoiTypeGroup[]> (
  groups: Groups & (
    Exclude<PoiTypeFlag, Groups[number]['options'][number]['flag']> extends never
      ? unknown
      : { missingPoiTypeFlags: Exclude<PoiTypeFlag, Groups[number]['options'][number]['flag']> }
  )
): Groups {
  return groups
}

/** The four ActiveCaptain POI-type groups, in display order. */
export const ACTIVE_CAPTAIN_POI_TYPE_GROUPS = definePoiTypeGroups([
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
] as const)

/** Summarize the selected ActiveCaptain POI types for the collapsed card. */
export function activeCaptainPoiTypeSelectionLabel (
  config: Partial<Record<PoiTypeFlag, boolean>>
): string {
  const groups: readonly ActiveCaptainPoiTypeGroup[] = ACTIVE_CAPTAIN_POI_TYPE_GROUPS
  let selected = 0
  let total = 0
  for (const group of groups) {
    for (const option of group.options) {
      total++
      if (config[option.flag] === true) selected++
    }
  }
  if (selected === 0) return 'no POI types'
  if (selected === total) return 'all POI types'
  return `${selected} of ${total} POI types`
}
