/**
 * Textarea for the OpenSeaMap source's optional Overpass fallback endpoints,
 * one URL per line. The list is stored as a string array: the field joins it
 * with newlines for display and splits the edited text back into lines. Blank
 * and duplicate lines are cleaned where the list is consumed, so editing stays
 * unconstrained here (a user can keep a blank line mid-edit).
 */

import type * as React from 'react'
import { LabeledField, Textarea } from 'signalk-nearlcrews-ui'
import { RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS } from '../../shared/overpass-endpoints.js'

/** Hoisted so the placeholder string is not re-joined on every render. */
const PLACEHOLDER = RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS.join('\n')

/** Room for the suggested mirrors without scrolling. */
const VISIBLE_ROWS = 3

interface Props {
  value: string[]
  onChange: (endpoints: string[]) => void
}

/** The Overpass fallback-endpoints field shown in the OpenSeaMap card body. */
export default function FallbackEndpointsField ({ value, onChange }: Props): React.ReactElement {
  return (
    <LabeledField
      label='Fallback endpoints'
      layout='inline'
      description={
        <>
          Optional Overpass mirrors, one per line, tried in order when the primary
          endpoint is unreachable. Leave empty to use only the primary. The
          placeholder shows suggested full-planet mirrors. Avoid regional extracts
          such as overpass.osm.ch, which return no data outside their region.
        </>
      }
    >
      <Textarea
        monospace
        minRows={VISIBLE_ROWS}
        value={value.join('\n')}
        placeholder={PLACEHOLDER}
        onChange={(event) => onChange(event.target.value.split('\n'))}
      />
    </LabeledField>
  )
}
