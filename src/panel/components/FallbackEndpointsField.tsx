/**
 * Textarea for the OpenSeaMap source's optional Overpass fallback endpoints,
 * one URL per line. The list is stored as a string array: the field joins it
 * with newlines for display and splits the edited text back into lines. Blank
 * and duplicate lines are cleaned where the list is consumed, so editing stays
 * unconstrained here (a user can keep a blank line mid-edit).
 */

import type * as React from 'react'
import { Textarea } from 'signalk-nearlcrews-ui'
import LabeledField from './LabeledField.js'
import { RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS } from '../../shared/overpass-endpoints.js'

/** Stable id linking the visible label to its input. */
const FIELD_ID = 'ac-openseamap-fallback-endpoints'

/** Hoisted so the textarea style object is not rebuilt on every render. */
const TEXTAREA_STYLE: React.CSSProperties = { minHeight: 56, fontFamily: 'monospace' }

/** Hoisted so the placeholder string is not re-joined on every render. */
const PLACEHOLDER = RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS.join('\n')

interface Props {
  value: string[]
  onChange: (endpoints: string[]) => void
}

/** The Overpass fallback-endpoints field shown in the OpenSeaMap card body. */
export default function FallbackEndpointsField ({ value, onChange }: Props): React.ReactElement {
  return (
    <LabeledField
      id={FIELD_ID}
      label='Fallback endpoints'
      hint={
        <>
          Optional Overpass mirrors, one per line, tried in order when the primary
          endpoint is unreachable. Leave empty to use only the primary. The
          placeholder shows suggested full-planet mirrors. Avoid regional extracts
          such as overpass.osm.ch, which return no data outside their region.
        </>
      }
    >
      {(controlProps) => (
        <Textarea
          {...controlProps}
          style={TEXTAREA_STYLE}
          value={value.join('\n')}
          placeholder={PLACEHOLDER}
          onChange={(e) => onChange(e.target.value.split('\n'))}
        />
      )}
    </LabeledField>
  )
}
