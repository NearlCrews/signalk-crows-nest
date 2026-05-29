/**
 * Translation from the plugin's POI-type configuration toggles to the
 * comma-separated `poiTypes` string the aggregate POI source uses to scope
 * list requests. ActiveCaptain's bounding-box endpoint is the original
 * consumer, and other inputs accept the same comma-separated form.
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
  // Single pass over the flag table: collect the selected types and note
  // whether any flag key is present at all, so the "select none" and
  // "pre-toggles config" cases are told apart without a second scan.
  const selected: PoiType[] = []
  let anyFlagPresent = false
  for (const [flag, poiType] of POI_TYPE_FLAGS) {
    if (flag in config) anyFlagPresent = true
    if (config[flag] === true) selected.push(poiType)
  }

  if (selected.length > 0) {
    return selected.join(',')
  }

  // Nothing is selected. Tell a deliberate "select none" (the flag keys are
  // present and all false) from a pre-toggles config (no flag keys at all).
  if (anyFlagPresent) {
    return null
  }
  return POI_TYPE_FLAGS.map(([, poiType]) => poiType).join(',')
}

/**
 * Ensure the POI-types string includes every type in `required`. The position
 * monitor's per-tick fetch uses it, and the position-driven outputs can only
 * act on points of interest the fetch returned.
 *
 * This is deliberately the ONE place the user's "select none" choice is
 * overridden: if the operator enabled the proximity-alarm or route-hazard
 * output, the per-tick monitor scan force-includes Hazard / Bridge / Lock
 * so the alarm has data to fire on. The chart-display path
 * (`notes-resource-output.listResources`) still respects the user's
 * selection, so a user who turned every POI-type toggle off sees a clean
 * chart but still gets alarms. The split is intentional, not a bug: alarms
 * are a safety output independent of chart display.
 */
export function ensurePoiTypes (poiTypes: string | null, required: readonly string[]): string {
  const present = (poiTypes === null || poiTypes === '') ? [] : poiTypes.split(',')
  const seen = new Set(present)
  const merged = [...present]
  for (const type of required) {
    if (!seen.has(type)) {
      seen.add(type)
      merged.push(type)
    }
  }
  return merged.join(',')
}
