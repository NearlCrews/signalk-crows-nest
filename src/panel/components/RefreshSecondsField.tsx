/**
 * Number input for a per-source bbox-debounce window, in seconds. A thin
 * wrapper around the shared NumberField that fixes the `[0, 3600]` clamp
 * every refresh-seconds field needs. The shared stale-while-revalidate
 * mechanism is described here, once, so the cards cannot drift on how the
 * cache behaves; each card passes only the sentence about its own upstream.
 *
 * A source whose refresh period is not that mechanism passes `description`
 * and replaces the text outright, which is what keeps it on this one field
 * rather than hand-rolling a second `NumberField` with the same bounds, the
 * same label, and the same draft reset.
 */

import type * as React from 'react'
import { NumberField } from 'signalk-nearlcrews-ui'
import { useDraftResetKey } from '../hooks/draft-reset-context.js'
import {
  MAX_BBOX_DEBOUNCE_SECONDS,
  MIN_BBOX_DEBOUNCE_SECONDS
} from '../../shared/bbox-debounce-bounds.js'

/**
 * Exactly one of the two descriptions, never both and never neither. Written
 * as a union rather than two optional props so the combinations that have no
 * meaning do not compile: both set, where one would silently win, and both
 * omitted, which rendered the shared text with a dangling space where the
 * upstream sentence should have been.
 */
type DescriptionProps =
  | {
    /**
     * The upstream-specific sentence appended to the shared mechanism
     * description: name the source's upstream and why its default cadence
     * fits that upstream's real update rate.
     */
    upstreamHint: React.ReactNode
    description?: undefined
  }
  | {
    /**
     * Replaces the shared stale-while-revalidate description outright, for a
     * source whose refresh period is not that mechanism. USCG Local Notice to
     * Mariners re-downloads whole notice files on a schedule rather than
     * revalidating a per-viewport result, so describing it as a viewport cache
     * would be wrong rather than merely wordy.
     */
    description: React.ReactNode
    upstreamHint?: undefined
  }

type Props = DescriptionProps & {
  /** Committed value. */
  value: number
  /** Called with the clamped value on every keystroke. */
  onChange: (seconds: number) => void
}

/** The shared per-bbox refresh-period field used by the at-runtime cards. */
export default function RefreshSecondsField ({
  upstreamHint,
  description,
  value,
  onChange
}: Props): React.ReactElement {
  return (
    <NumberField
      label='Refresh period'
      description={description ?? (
        <>
          How long to reuse the most recent result for the same chart viewport
          before re-querying in the background. An already-seen view is served
          from cache instantly either way; this only sets how often it is
          revalidated upstream. Leave at 0 to query upstream on every list
          call. {upstreamHint}
        </>
      )}
      layout='inline'
      unit='seconds'
      value={value}
      onValueChange={onChange}
      min={MIN_BBOX_DEBOUNCE_SECONDS}
      max={MAX_BBOX_DEBOUNCE_SECONDS}
      fallback={MIN_BBOX_DEBOUNCE_SECONDS}
      integer
      resetKey={useDraftResetKey()}
    />
  )
}
