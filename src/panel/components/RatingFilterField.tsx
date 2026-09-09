/**
 * Number input for the minimumRating setting. A thin wrapper around the
 * shared NumberField that fixes the label, hint, and 0-to-5 clamp the rating
 * range needs. Ratings step in halves: the arrows move half a star and a typed
 * value snaps to the nearest half, which is the precision ActiveCaptain
 * reviews carry.
 */

import type * as React from 'react'
import { NumberField } from 'signalk-nearlcrews-ui'
import { useDraftResetKey } from '../hooks/draft-reset-context.js'
import { MAX_RATING, MIN_RATING } from '../../shared/rating.js'

/** Half a star per arrow press, and the resolution typed ratings snap to. */
const HALF_STAR_STEP = 0.5

interface Props {
  value: number
  onChange: (rating: number) => void
}

/** The minimum-rating filter field shown in the configuration panel. */
export default function RatingFilterField ({ value, onChange }: Props): React.ReactElement {
  return (
    <NumberField
      label='Minimum rating'
      description={`Hide points of interest whose average review rating is below this value (${MIN_RATING} to ${MAX_RATING}). Leave it at ${MIN_RATING} to show every rating.`}
      layout='inline'
      value={value}
      onValueChange={onChange}
      min={MIN_RATING}
      max={MAX_RATING}
      step={HALF_STAR_STEP}
      fallback={MIN_RATING}
      resetKey={useDraftResetKey()}
    />
  )
}
