/**
 * Text input for the OpenSeaMap source's Overpass API endpoint URL. The URL is
 * a free-form string, so the field is a plain controlled input: it commits
 * every keystroke and applies no clamping. The monospace face makes a typo in
 * a host name easier to spot.
 */

import type * as React from 'react'
import { LabeledField, TextInput } from 'signalk-nearlcrews-ui'

interface Props {
  value: string
  onChange: (url: string) => void
}

/** The Overpass API endpoint field shown in the OpenSeaMap card body. */
export default function EndpointUrlField ({ value, onChange }: Props): React.ReactElement {
  return (
    <LabeledField
      label='Overpass API endpoint URL'
      layout='inline'
      description={
        <>
          The OpenStreetMap Overpass API endpoint the OpenSeaMap source queries.
          Leave the default unless you run your own Overpass instance.
        </>
      }
    >
      <TextInput
        type='url'
        monospace
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </LabeledField>
  )
}
