/**
 * Number input for a per-source minimum-year filter. A thin wrapper around
 * the shared NumberField that fixes the 0-to-9999 clamp the year field needs;
 * the label and hint are passed in per source because each source describes
 * its date a little differently (survey date for NOAA ENC, update date for
 * USCG Light List, last-edit date for OpenSeaMap).
 */

import type * as React from 'react'
import { NumberField } from 'signalk-nearlcrews-ui'
import { useDraftResetKey } from '../hooks/draft-reset-context.js'
import { clampMinimumYear, DEFAULT_MINIMUM_YEAR, MAX_YEAR } from '../../shared/year-filter.js'

interface Props {
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
  label,
  hint,
  value,
  onChange
}: Props): React.ReactElement {
  return (
    <NumberField
      label={label}
      description={hint}
      layout='inline'
      value={value}
      onValueChange={(year) => onChange(clampMinimumYear(year))}
      // The off sentinel is 0, so the field floor has to admit it; clampMinimumYear
      // owns raising a positive year below the validation floor up to it.
      min={0}
      max={MAX_YEAR}
      fallback={DEFAULT_MINIMUM_YEAR}
      integer
      resetKey={useDraftResetKey()}
    />
  )
}
