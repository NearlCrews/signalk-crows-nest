/**
 * Textarea for the OpenSeaMap source's optional Overpass fallback endpoints,
 * one URL per line. The list is stored as a string array: the field joins it
 * with newlines for display and splits the edited text back into lines. Blank
 * and duplicate lines are cleaned where the list is consumed, so editing stays
 * unconstrained here (a user can keep a blank line mid-edit).
 *
 * It reports a line the plugin would drop, for the same reason the endpoint
 * field above it does: a dropped mirror is silently absent rather than
 * reported, so the operator would never learn the typo was there.
 */

import type * as React from 'react'
import { LabeledField, Textarea } from 'signalk-nearlcrews-ui'
import { RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS } from '../../shared/overpass-endpoints.js'
import { FALLBACK_LABEL, fallbackEndpointsError } from '../endpoint-validation.js'

/** Hoisted so the placeholder string is not re-joined on every render. */
const PLACEHOLDER = RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS.join('\n')

/** Room for the suggested mirrors without scrolling. */
const VISIBLE_ROWS = 3

/**
 * Split edited text into stored lines.
 *
 * An all-blank textarea stores the empty list rather than `['']`, which is
 * what `''.split('\n')` yields: that single blank entry never matches the
 * empty list the configuration loads with, so the panel stayed dirty after a
 * no-op edit and a save wrote `[""]` to the configuration. Text with any
 * content keeps its blank lines, so a list stays editable mid-edit.
 */
function storedLines (text: string): string[] {
  const lines = text.split('\n')
  return lines.every((line) => line.trim() === '') ? [] : lines
}

interface Props {
  value: string[]
  onChange: (endpoints: string[]) => void
}

/** The Overpass fallback-endpoints field shown in the OpenSeaMap card body. */
export default function FallbackEndpointsField ({ value, onChange }: Props): React.ReactElement {
  return (
    <LabeledField
      label={FALLBACK_LABEL}
      layout='inline'
      description={
        <>
          Optional Overpass mirrors, one per line, tried in order when the primary
          endpoint is unreachable. Leave empty to use only the primary. The
          placeholder shows suggested full-planet mirrors. Avoid regional extracts
          such as overpass.osm.ch, which return no data outside their region.
        </>
      }
      error={fallbackEndpointsError(value)}
    >
      {/*
        A textarea gets sentence capitalization, autocorrection, and spell
        checking by default, which the URL input beside it does not, because
        the url input type turns them off on its own. A tablet at the helm
        would otherwise capitalize and correct each mirror as it is typed,
        and draw a spelling underline under every line of a valid list.
      */}
      <Textarea
        monospace
        minRows={VISIBLE_ROWS}
        autoCapitalize='none'
        autoCorrect='off'
        spellCheck={false}
        value={value.join('\n')}
        placeholder={PLACEHOLDER}
        onChange={(event) => onChange(storedLines(event.target.value))}
      />
    </LabeledField>
  )
}
