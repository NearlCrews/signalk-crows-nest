/**
 * Translation from the plugin's POI-type configuration toggles to the
 * comma-separated `poiTypes` string the ActiveCaptain bounding-box endpoint
 * expects.
 */

import type { PluginConfig, PoiType, PoiTypeFlag } from './types.js'

/**
 * Every selectable POI type, paired with the config flag that enables it. When
 * no flag is enabled the plugin falls back to requesting all of them.
 */
export const POI_TYPE_FLAGS: ReadonlyArray<readonly [PoiTypeFlag, PoiType]> = [
  ['includeMarinas', 'Marina'],
  ['includeAnchorages', 'Anchorage'],
  ['includeHazards', 'Hazard'],
  ['includeBusinesses', 'Business'],
  ['includeBoatRamps', 'BoatRamp'],
  ['includeBridges', 'Bridge'],
  ['includeDams', 'Dam'],
  ['includeFerries', 'Ferry'],
  ['includeInlets', 'Inlet'],
  ['includeLocks', 'Lock'],
  ['includeLocalKnowledge', 'LocalKnowledge'],
  ['includeNavigational', 'Navigational'],
  ['includeAirports', 'Airport']
]

/**
 * Build the comma-separated `poiTypes` string the ActiveCaptain API expects
 * from the plugin configuration.
 *
 * Returns null when the configuration explicitly selects no POI type, meaning
 * the plugin should import nothing. A configuration saved before the POI-type
 * toggles existed carries none of the flag keys at all; that is treated as
 * "every type" so an upgraded install keeps working until it is reconfigured.
 */
export function buildPoiTypesString (config: Partial<PluginConfig>): string | null {
  const selected = POI_TYPE_FLAGS
    .filter(([flag]) => config[flag] === true)
    .map(([, poiType]) => poiType)

  if (selected.length > 0) {
    return selected.join(',')
  }

  // Nothing is selected. Tell a deliberate "select none" (the flag keys are
  // present and all false) from a pre-toggles config (no flag keys at all).
  const anyFlagPresent = POI_TYPE_FLAGS.some(([flag]) => flag in config)
  if (anyFlagPresent) {
    return null
  }
  return POI_TYPE_FLAGS.map(([, poiType]) => poiType).join(',')
}

/**
 * Ensure the POI-types string includes every type in `required`. The position
 * monitor's per-tick fetch uses it, and the position-driven outputs can only
 * act on points of interest the fetch returned.
 */
export function ensurePoiTypes (poiTypes: string | null, required: readonly string[]): string {
  const present = (poiTypes === null || poiTypes === '') ? [] : poiTypes.split(',')
  const merged = [...present]
  for (const type of required) {
    if (!merged.includes(type)) {
      merged.push(type)
    }
  }
  return merged.join(',')
}
