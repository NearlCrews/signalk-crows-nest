/**
 * Textarea for the OpenSeaMap source's optional Overpass fallback endpoints,
 * one URL per line. The list is stored as a string array: the field joins it
 * with newlines for display and splits the edited text back into lines. Blank
 * and duplicate lines are cleaned where the list is consumed, so editing stays
 * unconstrained here (a user can keep a blank line mid-edit).
 */

import type * as React from 'react'
import { S } from '../styles.js'
import { RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS } from '../normalize-config.js'

/** Stable id linking the visible label to its input. */
const FIELD_ID = 'ac-openseamap-fallback-endpoints'

interface Props {
  value: string[]
  onChange: (endpoints: string[]) => void
}

/** The Overpass fallback-endpoints field shown in the OpenSeaMap card body. */
export default function FallbackEndpointsField ({ value, onChange }: Props): React.ReactElement {
  return (
    <>
      <div style={S.fieldRow}>
        <label htmlFor={FIELD_ID} style={S.label}>Fallback endpoints</label>
        <textarea
          id={FIELD_ID}
          style={{ ...S.inputWide, minHeight: 56, fontFamily: 'monospace' }}
          value={value.join('\n')}
          placeholder={RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS.join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
        />
      </div>
      <p style={S.hintBelow}>
        Optional Overpass mirrors, one per line, tried in order when the primary
        endpoint is unreachable. Leave empty to use only the primary. The
        placeholder shows suggested full-planet mirrors. Avoid regional extracts
        such as overpass.osm.ch, which return no data outside their region.
      </p>
    </>
  )
}
