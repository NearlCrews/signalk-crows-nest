/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
