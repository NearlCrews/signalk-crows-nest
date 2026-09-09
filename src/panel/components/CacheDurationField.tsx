/**
 * Number input for the cachingDurationMinutes setting. A thin wrapper around
 * the shared NumberField that fixes the label, hint, unit, and
 * integer-with-floor-of-1 commit behavior the cache duration needs.
 */

import type * as React from 'react'
import { NumberField } from 'signalk-nearlcrews-ui'
import { useDraftResetKey } from '../hooks/draft-reset-context.js'
import { MIN_CACHE_DURATION_MINUTES } from '../../shared/cache-duration.js'

interface Props {
  value: number
  onChange: (minutes: number) => void
}

/** The cache-duration field shown in the configuration panel. */
export default function CacheDurationField ({ value, onChange }: Props): React.ReactElement {
  return (
    <NumberField
      label='Cache duration'
      description='How long imported ActiveCaptain data is cached. Longer means less data traffic, shorter means fresher data.'
      layout='inline'
      unit='minutes'
      value={value}
      onValueChange={onChange}
      min={MIN_CACHE_DURATION_MINUTES}
      fallback={MIN_CACHE_DURATION_MINUTES}
      integer
      resetKey={useDraftResetKey()}
    />
  )
}
