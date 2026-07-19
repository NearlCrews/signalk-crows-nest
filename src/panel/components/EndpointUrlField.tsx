/**
 * Text input for the OpenSeaMap source's Overpass API endpoint URL. The URL is
 * a free-form string, so the field is a plain controlled input: it commits
 * every keystroke and applies no clamping.
 */

import type * as React from 'react'
import { TextInput } from 'signalk-nearlcrews-ui'
import LabeledField from './LabeledField.js'

/** Stable id linking the visible label to its input. */
const FIELD_ID = 'ac-openseamap-endpoint'

interface Props {
  value: string
  onChange: (url: string) => void
}

/** The Overpass API endpoint field shown in the OpenSeaMap card body. */
export default function EndpointUrlField ({ value, onChange }: Props): React.ReactElement {
  return (
    <LabeledField
      id={FIELD_ID}
      label='Overpass API endpoint URL'
      hint={
        <>
          The OpenStreetMap Overpass API endpoint the OpenSeaMap source queries.
          Leave the default unless you run your own Overpass instance.
        </>
      }
    >
      {(controlProps) => (
        <TextInput
          {...controlProps}
          type='url'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </LabeledField>
  )
}
