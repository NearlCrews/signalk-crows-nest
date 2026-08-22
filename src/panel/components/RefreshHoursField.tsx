/**
 * Number input for a bulk-download source's background refresh period, in
 * hours. A thin wrapper around NumberField that fixes the shared
 * `[MIN_REFRESH_HOURS, MAX_REFRESH_HOURS]` clamp and the integer step every
 * refresh-hours field needs, mirroring RefreshSecondsField's shape. The
 * shared download mechanism is described here, once, so the three cards
 * cannot drift on how the refresh behaves; each card passes only the sentence
 * about its own upstream.
 */

import type * as React from 'react'
import { MAX_REFRESH_HOURS, MIN_REFRESH_HOURS } from '../../shared/refresh-hours.js'
import NumberField from './NumberField.js'

interface Props {
  /**
   * The upstream-specific sentence appended to the shared mechanism
   * description: name the source's upstream and why its default cadence fits
   * that upstream's real publication rate.
   */
  upstreamHint: React.ReactNode
  /** Committed value. */
  value: number
  /** Called with the clamped value on every keystroke. */
  onChange: (hours: number) => void
}

/** The shared background refresh-period field used by the bulk-download cards. */
export default function RefreshHoursField ({
  upstreamHint,
  value,
  onChange
}: Props): React.ReactElement {
  return (
    <NumberField
      label='Refresh period (hours)'
      hint={
        <>
          How often the plugin re-downloads the source in the background. The
          downloaded index stays available offline between refreshes, so a
          longer period costs freshness rather than availability.{' '}
          {upstreamHint}
        </>
      }
      value={value}
      onChange={onChange}
      min={MIN_REFRESH_HOURS}
      max={MAX_REFRESH_HOURS}
      integer
      step={1}
    />
  )
}
