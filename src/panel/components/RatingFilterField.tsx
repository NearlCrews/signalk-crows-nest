/**
 * Number input for the minimumRating setting. A thin wrapper around
 * NumberField that fixes the label, hint, and 0-to-5 clamp the rating range
 * needs. Fractional ratings such as 3.5 are allowed.
 */

import type * as React from 'react'
import { MAX_RATING, MIN_RATING } from '../../shared/rating.js'
import NumberField from './NumberField.js'

interface Props {
  value: number
  onChange: (rating: number) => void
}

/** The minimum-rating filter field shown in the configuration panel. */
export default function RatingFilterField ({ value, onChange }: Props): React.ReactElement {
  return (
    <NumberField
      id='ac-minimum-rating'
      label='Minimum rating'
      hint={`Hide points of interest whose average review rating is below this value (${MIN_RATING} to ${MAX_RATING}). Leave it at ${MIN_RATING} to show every rating.`}
      value={value}
      onChange={onChange}
      min={MIN_RATING}
      max={MAX_RATING}
      step={0.5}
    />
  )
}
