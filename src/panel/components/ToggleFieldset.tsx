/**
 * Presentational shell for a titled, opt-in fieldset: the standard `S.group`
 * fieldset, its legend, a checkbox row that toggles the section on, an optional
 * hint paragraph below the toggle, and a `children` slot for the field or
 * fields the section controls.
 *
 * `ProximityAlarmFields`, `RouteHazardScanFields`, `MergeWithActiveCaptain`,
 * and `BridgeAirDraftFields` each compose this shell and slot their own
 * field(s) as `children`, so the fieldset, legend, checkbox row, and hint
 * markup live in one place rather than being reimplemented per control group. The fieldset is itself the section: it
 * deliberately has no nested `<section>` wrapper, since the parent (the alerts
 * section or a data-source card) already provides the landmark and a nested one
 * only makes screen-reader landmark navigation noisier.
 */

import type * as React from 'react'
import { S } from '../styles.js'

interface Props {
  /** Fieldset legend, the section name. */
  title: string
  /** Label for the opt-in toggle checkbox. */
  toggleLabel: React.ReactNode
  /** Optional hint paragraph rendered below the toggle. */
  toggleHint?: React.ReactNode
  /** Whether the section is enabled. */
  enabled: boolean
  /** Called when the toggle is flipped. */
  onToggleEnabled: (enabled: boolean) => void
  /** The field or fields the section controls. */
  children: React.ReactNode
}

/** A titled, opt-in fieldset shell with a toggle and a children slot. */
export default function ToggleFieldset ({
  title,
  toggleLabel,
  toggleHint,
  enabled,
  onToggleEnabled,
  children
}: Props): React.ReactElement {
  return (
    <fieldset style={S.group}>
      <legend style={S.groupTitle}>{title}</legend>
      <label style={S.checkboxRow}>
        <input
          type='checkbox'
          style={S.checkbox}
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
        />
        {toggleLabel}
      </label>
      {toggleHint !== undefined && <p style={S.hint}>{toggleHint}</p>}
      {children}
    </fieldset>
  )
}
