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
 * UI metadata for the POI-type section of the configuration panel: the four
 * labelled groups and the human-readable label for each toggle. Every flag is
 * one of the includeX booleans on PluginConfig, so all 13 POI types appear
 * exactly once across the groups.
 */

import type { PoiTypeFlag } from '../types.js'

/** A single POI-type toggle: its PluginConfig flag and its display label. */
export interface PoiTypeOption {
  flag: PoiTypeFlag
  label: string
}

/** A labelled group of related POI-type toggles. */
export interface PoiTypeGroup {
  title: string
  options: readonly PoiTypeOption[]
}

/** The four POI-type groups, in display order. */
export const POI_TYPE_GROUPS: readonly PoiTypeGroup[] = [
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
]
