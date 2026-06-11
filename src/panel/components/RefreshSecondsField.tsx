/**
 * Number input for a per-source bbox-debounce window, in seconds. A thin
 * wrapper around NumberField that fixes the `[0, 3600]` clamp and the
 * integer step every refresh-seconds field needs. The shared
 * stale-while-revalidate mechanism is described here, once, so the three
 * cards cannot drift on how the cache behaves; each card passes only the
 * sentence about its own upstream.
 */

import type * as React from 'react'
import {
  MAX_BBOX_DEBOUNCE_SECONDS,
  MIN_BBOX_DEBOUNCE_SECONDS
} from '../../shared/bbox-debounce.js'
import NumberField from './NumberField.js'

interface Props {
  /** Stable id linking the visible label to the input. */
  id: string
  /** Visible field label, e.g. `Refresh period (seconds)`. */
  label: string
  /**
   * The upstream-specific sentence appended to the shared mechanism
   * description: name the source's upstream and why its default cadence
   * fits that upstream's real update rate.
   */
  upstreamHint: React.ReactNode
  /** Committed value. */
  value: number
  /** Called with the clamped value on every keystroke. */
  onChange: (seconds: number) => void
}

/** The shared per-bbox refresh-period field used by the at-runtime cards. */
export default function RefreshSecondsField ({
  id,
  label,
  upstreamHint,
  value,
  onChange
}: Props): React.ReactElement {
  return (
    <NumberField
      id={id}
      label={label}
      hint={
        <>
          How long to reuse the most recent result for the same chart viewport
          before re-querying in the background. An already-seen view is served
          from cache instantly either way; this only sets how often it is
          revalidated upstream. Leave at 0 to query upstream on every list
          call. {upstreamHint}
        </>
      }
      value={value}
      onChange={onChange}
      min={MIN_BBOX_DEBOUNCE_SECONDS}
      max={MAX_BBOX_DEBOUNCE_SECONDS}
      integer
      step={5}
    />
  )
}
