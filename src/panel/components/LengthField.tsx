/**
 * A NumberField for a length stored in meters, rendered in the display system
 * the server's unit preferences select. The parent always deals in meters
 * (the config's only length unit); this component converts the value and the
 * bounds at the display edge and appends the unit to the label, so an
 * imperial preset shows feet without the stored configuration changing
 * shape.
 */

import type * as React from 'react'
import { useContext } from 'react'
import NumberField from './NumberField.js'
import { UnitSystemContext } from '../hooks/use-unit-system.js'
import { clampNumber } from '../../shared/numbers.js'
import {
  lengthDisplayFromMeters,
  lengthMetersFromDisplay,
  lengthUnitLabel
} from '../unit-system.js'

interface Props {
  /** Stable id linking the visible label to the input. */
  id: string
  /** Field label without a unit suffix; the display unit is appended. */
  label: string
  /** Hint paragraph rendered next to the input. */
  hint: React.ReactNode
  /** Committed value, in meters. */
  valueMeters: number
  /** Called with the committed value, in meters, on every keystroke. */
  onChangeMeters: (meters: number) => void
  /** Smallest allowed value, in meters. */
  minMeters: number
  /** Largest allowed value, in meters. Omit to leave the high end unbounded. */
  maxMeters?: number
  /** Step the up/down arrows use, in display units. */
  step?: number
  /** Truncate any fractional part of the typed display value. */
  integer?: boolean
  /** Disable the input. */
  disabled?: boolean
  /** Use the tighter labelled-input row layout used below an alarm toggle. */
  dense?: boolean
}

/** A meters-backed numeric field rendered in the preferred display unit. */
export default function LengthField ({
  id,
  label,
  hint,
  valueMeters,
  onChangeMeters,
  minMeters,
  maxMeters,
  step,
  integer,
  disabled,
  dense
}: Props): React.ReactElement {
  const system = useContext(UnitSystemContext)

  return (
    <NumberField
      id={id}
      label={`${label} (${lengthUnitLabel(system)})`}
      hint={hint}
      value={lengthDisplayFromMeters(valueMeters, system)}
      onChange={(display) => onChangeMeters(
        // Re-clamp in meters, the authoritative space: the display-side bounds
        // are nearest-rounded, so committing exactly the displayed minimum can
        // land a hair under the schema bound (3.28 ft is 0.9997 m against a
        // 1 m minimum) without this.
        clampNumber(lengthMetersFromDisplay(display, system), minMeters, maxMeters ?? Infinity, minMeters)
      )}
      min={lengthDisplayFromMeters(minMeters, system)}
      max={maxMeters === undefined ? undefined : lengthDisplayFromMeters(maxMeters, system)}
      step={step}
      integer={integer}
      disabled={disabled}
      dense={dense}
    />
  )
}
