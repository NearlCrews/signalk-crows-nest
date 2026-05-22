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
 * The POI-type selector: the 13 toggles laid out in four labelled groups, with
 * All and None bulk buttons. A note appears when nothing is selected, because
 * the plugin then imports every type rather than none.
 */

import type * as React from 'react'
import type { PluginConfig, PoiTypeFlag } from '../../types.js'
import { POI_TYPE_GROUPS } from '../poiTypeGroups.js'
import { S } from '../styles.js'

interface Props {
  config: PluginConfig
  onToggle: (flag: PoiTypeFlag, enabled: boolean) => void
  onSetAll: (enabled: boolean) => void
}

/** The grouped POI-type checkboxes shown in the configuration panel. */
export default function PoiTypeGroups ({ config, onToggle, onSetAll }: Props): React.ReactElement {
  const anySelected = POI_TYPE_GROUPS.some(
    (group) => group.options.some((option) => config[option.flag] === true)
  )

  return (
    <section style={S.groupsSection}>
      <div style={S.groupsHeader}>
        <span style={S.groupsTitle}>POI types to import</span>
        <button type='button' style={S.btnBulk} onClick={() => onSetAll(true)}>All</button>
        <button type='button' style={S.btnBulk} onClick={() => onSetAll(false)}>None</button>
      </div>
      {POI_TYPE_GROUPS.map((group) => (
        <fieldset key={group.title} style={S.group}>
          <legend style={S.groupTitle}>{group.title}</legend>
          <div style={S.checkboxGrid}>
            {group.options.map((option) => (
              <label key={option.flag} style={S.checkboxLabel}>
                <input
                  type='checkbox'
                  style={S.checkbox}
                  checked={config[option.flag] === true}
                  onChange={(e) => onToggle(option.flag, e.target.checked)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {anySelected
        ? null
        : (
          <p style={S.hint}>
            No POI types are selected, so the plugin imports every type. Choose
            at least one to narrow the import.
          </p>
          )}
    </section>
  )
}
