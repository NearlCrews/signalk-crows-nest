/**
 * A shared `NumberField` for a length stored in meters, rendered in the
 * display system the server's unit preferences select. The parent always
 * deals in meters (the config's only length unit); this component converts
 * the value and the bounds at the display edge and shows the unit beside the
 * input, so an imperial preset shows feet without the stored configuration
 * changing shape.
 *
 * The field clamps rather than validates: an empty or unparsable draft
 * commits the display minimum, matching the schema floor the plugin enforces.
 */

import type * as React from 'react'
import { useContext } from 'react'
import { NumberField } from 'signalk-nearlcrews-ui'
import { useDraftResetKey } from '../hooks/draft-reset-context.js'
import { UnitSystemContext } from '../hooks/use-unit-system.js'
import { clampNumber } from '../../shared/numbers.js'
import {
  lengthDisplayFromMeters,
  lengthMetersFromDisplay,
  lengthUnitLabel
} from '../unit-system.js'

interface Props {
  /** Field label without a unit; the display unit renders beside the input. */
  label: string
  /** Description linked to the input through aria-describedby. */
  hint: React.ReactNode
  /** Committed value, in meters. */
  valueMeters: number
  /** Called with the committed value, in meters, on every keystroke. */
  onChangeMeters: (meters: number) => void
  /** Smallest allowed value, in meters. */
  minMeters: number
  /** Largest allowed value, in meters. Omit to leave the high end unbounded. */
  maxMeters?: number
  /** Truncate any fractional part of the typed display value. */
  integer?: boolean
  /** Disable the input. */
  disabled?: boolean
  /** Use the tighter labeled-input row layout used below an alarm toggle. */
  dense?: boolean
}

/** A meters-backed numeric field rendered in the preferred display unit. */
export default function LengthField ({
  label,
  hint,
  valueMeters,
  onChangeMeters,
  minMeters,
  maxMeters,
  integer,
  disabled,
  dense
}: Props): React.ReactElement {
  const system = useContext(UnitSystemContext)
  const resetKey = useDraftResetKey()
  const displayMin = lengthDisplayFromMeters(minMeters, system)

  return (
    <NumberField
      label={label}
      description={hint}
      layout='inline'
      density={dense === true ? 'compact' : 'default'}
      unit={lengthUnitLabel(system)}
      value={lengthDisplayFromMeters(valueMeters, system)}
      onValueChange={(display) => onChangeMeters(
        // Re-clamp in meters, the authoritative space: the display-side bounds
        // are nearest-rounded, so committing exactly the displayed minimum can
        // land a hair under the schema bound (3.28 ft is 0.9997 m against a
        // 1 m minimum) without this.
        clampNumber(lengthMetersFromDisplay(display, system), minMeters, maxMeters ?? Infinity, minMeters)
      )}
      min={displayMin}
      max={maxMeters === undefined ? undefined : lengthDisplayFromMeters(maxMeters, system)}
      fallback={displayMin}
      integer={integer}
      disabled={disabled}
      resetKey={resetKey}
    />
  )
}
