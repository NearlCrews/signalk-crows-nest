/**
 * The "Merge with ActiveCaptain" fieldset shared by every non-base source
 * card (OpenSeaMap, USCG Light List, NOAA ENC). Each non-base card had its
 * own near-identical copy of a toggle plus a merge-radius NumberField plus
 * a one-paragraph rationale; the duplication made the per-card files
 * harder to scan and was a real maintenance hazard whenever the copy
 * needed editing in one place. Centralizing the block here keeps every
 * card's merge UX in lockstep.
 *
 * The fieldset, legend, toggle, and hint shell come from `ToggleFieldset`;
 * this component slots its merge-radius NumberField as the children.
 */

import type * as React from 'react'
import { DEFAULT_DEDUPE_RADIUS_METERS } from '../../shared/dedupe-radius.js'
import NumberField from './NumberField.js'
import ToggleFieldset from './ToggleFieldset.js'

/** Smallest dedupe radius the plugin accepts (matches every schema minimum). */
const MIN_DEDUPE_RADIUS_METERS = 1

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
  /** Stable id linking the radius input to its visible label. */
  radiusInputId: string
}

/** A dedupe toggle plus merge-radius pair for one non-base source. */
export default function MergeWithActiveCaptain ({
  sourceName,
  enabled,
  onToggleEnabled,
  radiusMeters,
  onChangeRadius,
  radiusInputId
}: Props): React.ReactElement {
  return (
    <ToggleFieldset
      title='Merge with ActiveCaptain'
      toggleLabel={<>Merge {sourceName} markers that duplicate an ActiveCaptain marker</>}
      toggleHint={
        <>
          When enabled, a {sourceName} point of interest close to an
          ActiveCaptain point of the same type is merged into it, so one
          physical feature is shown once. The surviving marker records every
          source that reported it.
        </>
      }
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    >
      <NumberField
        id={radiusInputId}
        label='Merge radius (meters)'
        hint='How far apart two markers can be and still count as the same point.'
        value={radiusMeters ?? DEFAULT_DEDUPE_RADIUS_METERS}
        onChange={onChangeRadius}
        min={MIN_DEDUPE_RADIUS_METERS}
        step={10}
        integer
        disabled={!enabled}
        dense
      />
    </ToggleFieldset>
  )
}
