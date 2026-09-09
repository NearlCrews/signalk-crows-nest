/**
 * Number input for a bulk-download source's background refresh period, in
 * hours. A thin wrapper around the shared NumberField that fixes the shared
 * `[MIN_REFRESH_HOURS, MAX_REFRESH_HOURS]` clamp every refresh-hours field
 * needs, mirroring RefreshSecondsField's shape. The shared download mechanism
 * is described here, once, so the three cards cannot drift on how the refresh
 * behaves; each card passes only the sentence about its own upstream.
 */

import type * as React from 'react'
import { NumberField } from 'signalk-nearlcrews-ui'
import { useDraftResetKey } from '../hooks/draft-reset-context.js'
import { MAX_REFRESH_HOURS, MIN_REFRESH_HOURS } from '../../shared/refresh-hours.js'

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
      label='Refresh period'
      description={
        <>
          How often the plugin re-downloads the source in the background. The
          downloaded index stays available offline between refreshes, so a
          longer period costs freshness rather than availability.{' '}
          {upstreamHint}
        </>
      }
      layout='inline'
      unit='hours'
      value={value}
      onValueChange={onChange}
      min={MIN_REFRESH_HOURS}
      max={MAX_REFRESH_HOURS}
      fallback={MIN_REFRESH_HOURS}
      integer
      resetKey={useDraftResetKey()}
    />
  )
}
