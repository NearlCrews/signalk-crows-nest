/**
 * Number input for a per-source minimum-year filter. A thin wrapper around
 * NumberField that fixes the 0-to-9999 clamp and the integer step the year
 * field needs; the label and hint are passed in per source because each
 * source describes its date a little differently (survey date for NOAA ENC,
 * update date for USCG Light List, last-edit date for OpenSeaMap).
 */

import type * as React from 'react'
import { MAX_YEAR, MIN_YEAR } from '../../shared/year-filter.js'
import NumberField from './NumberField.js'

interface Props {
  /** Stable id linking the visible label to the input. */
  id: string
  /** Visible field label, e.g. `Earliest survey year`. */
  label: string
  /** Hint paragraph: should name the source's date semantic and the off value. */
  hint: React.ReactNode
  /** Committed value. */
  value: number
  /** Called with the clamped value on every keystroke. */
  onChange: (year: number) => void
}

/** The shared minimum-year filter field used by the per-source cards. */
export default function MinimumYearField ({
  id,
  label,
  hint,
  value,
  onChange
}: Props): React.ReactElement {
  return (
    <NumberField
      id={id}
      label={label}
      hint={hint}
      value={value}
      onChange={onChange}
      min={MIN_YEAR}
      max={MAX_YEAR}
      integer
      step={1}
    />
  )
}
