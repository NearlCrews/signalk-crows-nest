/**
 * Text input for the OpenSeaMap source's Overpass API endpoint URL. The URL is
 * a free-form string, so the field is a plain controlled input: it commits
 * every keystroke and applies no clamping. The monospace face makes a typo in
 * a host name easier to spot.
 *
 * It reports an unusable URL rather than clamping it, because the plugin
 * silently substitutes the default for one, so a typo that reaches the save
 * would be ignored and then lost. The save bar blocks on the same rule.
 */

import type * as React from 'react'
import { LabeledField, TextInput } from 'signalk-nearlcrews-ui'
import { PRIMARY_LABEL, primaryEndpointError } from '../endpoint-validation.js'

interface Props {
  value: string
  onChange: (url: string) => void
}

/** The Overpass API endpoint field shown in the OpenSeaMap card body. */
export default function EndpointUrlField ({ value, onChange }: Props): React.ReactElement {
  return (
    <LabeledField
      label={PRIMARY_LABEL}
      layout='inline'
      description={
        <>
          The OpenStreetMap Overpass API endpoint the OpenSeaMap source queries.
          Leave the default unless you run your own Overpass instance. Clear
          the field to return to the default.
        </>
      }
      error={primaryEndpointError(value)}
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
