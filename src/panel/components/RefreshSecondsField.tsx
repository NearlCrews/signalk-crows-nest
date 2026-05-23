/**
 * Number input for a per-source bbox-debounce window, in seconds. A thin
 * wrapper around NumberField that fixes the `[0, 600]` clamp and the
 * integer step every refresh-seconds field needs; the label and hint are
 * passed in because OpenSeaMap and NOAA ENC describe the upstream the same
 * way but using their own service name.
 */

import type * as React from 'react'
import {
  MAX_REFRESH_SECONDS,
  MIN_REFRESH_SECONDS
} from '../normalize-config.js'
import NumberField from './NumberField.js'

interface Props {
  /** Stable id linking the visible label to the input. */
  id: string
  /** Visible field label, e.g. `Refresh period (seconds)`. */
  label: string
  /** Hint paragraph: should name the source's upstream and the off value. */
  hint: React.ReactNode
  /** Committed value. */
  value: number
  /** Called with the clamped value on every keystroke. */
  onChange: (seconds: number) => void
}

/** The shared per-bbox refresh-period field used by the two at-runtime cards. */
export default function RefreshSecondsField ({
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
      min={MIN_REFRESH_SECONDS}
      max={MAX_REFRESH_SECONDS}
      integer
      step={5}
    />
  )
}
