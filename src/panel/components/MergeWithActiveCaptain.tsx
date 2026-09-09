/**
 * The "Merge with ActiveCaptain" group shared by every non-base source card
 * (OpenSeaMap, USCG Light List, NOAA ENC, NOAA CO-OPS, USCG LNM, World Port
 * Index, and USACE): a dedupe toggle, a merge-radius field, and the
 * one-paragraph rationale. Centralizing the block here keeps every card's
 * merge UX in lockstep.
 *
 * The fieldset and legend come from the shared `FieldGroup`; the toggle is a
 * shared `Checkbox` whose description carries the rationale, and the radius
 * is a `LengthField` disabled while the toggle is off because the setting
 * then has no effect.
 */

import type * as React from 'react'
import { Checkbox, FieldGroup } from 'signalk-nearlcrews-ui'
import {
  DEFAULT_DEDUPE_RADIUS_METERS,
  MIN_DEDUPE_RADIUS_METERS
} from '../../shared/dedupe-radius.js'
import LengthField from './LengthField.js'

interface Props {
  /** Human-readable source name, e.g. `OpenSeaMap`, used in the toggle label. */
  sourceName: string
  /** Whether the dedupe toggle is on. */
  enabled: boolean
  /** Fired when the toggle changes. */
  onToggleEnabled: (enabled: boolean) => void
  /** Currently-set merge radius in meters. */
  radiusMeters: number | undefined
  /** Fired on every keystroke of the radius input. */
  onChangeRadius: (meters: number) => void
}

/** A dedupe toggle plus merge-radius pair for one non-base source. */
export default function MergeWithActiveCaptain ({
  sourceName,
  enabled,
  onToggleEnabled,
  radiusMeters,
  onChangeRadius
}: Props): React.ReactElement {
  return (
    <FieldGroup legend='Merge with ActiveCaptain'>
      <Checkbox
        label={<>Merge {sourceName} markers that duplicate an ActiveCaptain marker</>}
        description={
          <>
            When enabled, a {sourceName} point of interest close to an
            ActiveCaptain point of the same type is merged into it, so one
            physical feature is shown once. The surviving marker records every
            source that reported it.
          </>
        }
        checked={enabled}
        onChange={(event) => onToggleEnabled(event.target.checked)}
      />
      <LengthField
        label='Merge radius'
        hint='How far apart two markers can be and still count as the same point.'
        valueMeters={radiusMeters ?? DEFAULT_DEDUPE_RADIUS_METERS}
        onChangeMeters={onChangeRadius}
        minMeters={MIN_DEDUPE_RADIUS_METERS}
        integer
        disabled={!enabled}
        dense
      />
    </FieldGroup>
  )
}
