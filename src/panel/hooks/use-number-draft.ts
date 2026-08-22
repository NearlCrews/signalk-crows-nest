/**
 * Raw-text draft state for a controlled numeric input. A bare controlled
 * `<input type='number'>` snaps back to the committed value on every
 * keystroke, so the user cannot clear the field mid-edit; this hook keeps the
 * literal typed string around until the input loses focus, then drops it so
 * the input renders the committed numeric value again.
 *
 * The hook also defines the canonical empty-input and parse-failure behavior:
 * both fall back to the configured `fallback` (or the minimum). A finite
 * parsed value is clamped to `[min, max]` and, when `integer: true`, truncated
 * to a whole number.
 */

import { useContext, useEffect, useRef, useState } from 'react'
import { DraftResetContext } from './draft-reset-context.js'

/** Options that shape how a draft string is parsed and clamped on commit. */
export interface NumberDraftOptions {
  /** Smallest allowed value. The fallback when the input is empty or unparsable. */
  min: number
  /** Largest allowed value. Omit to leave the high end unbounded. */
  max?: number
  /** Truncate any fractional part on commit. */
  integer?: boolean
  /** Value to commit for empty or unparsable input. Defaults to `min`. */
  fallback?: number
}

/** The state surface the controlled input consumes. */
export interface NumberDraft {
  /** The text the input should render: the live draft if any, otherwise the committed value. */
  display: string
  /** Track a keystroke and commit a clamped numeric value through `onChange`. */
  handleChange: (raw: string) => void
  /** Drop the live draft, so the input snaps back to the committed value. */
  handleBlur: () => void
}

/**
 * Compute the numeric value a raw draft string should commit to, applying the
 * empty/fallback rule, the parse-failure fallback, the integer-truncation
 * option, and the min/max clamp. Extracted from {@link useNumberDraft} as a
 * pure function so the parsing and clamping rules can be unit-tested under
 * node:test without React testing infrastructure.
 *
 * The hook's state-management bits (the draft buffer and the external-change
 * detector) remain in the hook because they depend on React state.
 */
export function commitNumberDraft (raw: string, options: NumberDraftOptions): number {
  const fallback = options.fallback ?? options.min
  if (raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  let next = parsed
  if (options.integer === true) next = Math.trunc(next)
  if (options.max !== undefined && next > options.max) next = options.max
  if (next < options.min) next = options.min
  return next
}

/**
 * Drive a controlled numeric input with a draft-while-editing buffer. `value`
 * is the committed number; `onChange` receives the clamped value for every
 * keystroke (so the parent's state stays in sync as the user types).
 */
export function useNumberDraft (
  value: number,
  onChange: (next: number) => void,
  options: NumberDraftOptions
): NumberDraft {
  const [draft, setDraft] = useState<string | null>(null)

  // Drop the draft on every Discard, keyed by the panel root's reset epoch.
  // The value-change detector below misses a Discard that restores a value
  // identical to the committed one (a typed "0" that clamped to the committed
  // minimum), and WebKit does not blur the input on a button click, so
  // without this the stale draft text would survive the Discard there.
  //
  // Both effects here compare against a ref rather than trusting the effect to
  // run only when their dependency changed. Every NumberField renders inside a
  // CollapsibleSection whose default mountStrategy is 'retain', which wraps
  // children in React Activity: collapsing runs effect cleanups and reopening
  // re-runs the effects, while component state survives. An unguarded
  // setDraft(null) here would therefore wipe an in-progress edit every time
  // the operator collapsed and reopened a card.
  const resetEpoch = useContext(DraftResetContext)
  const seenEpoch = useRef(resetEpoch)
  useEffect(() => {
    if (seenEpoch.current === resetEpoch) return
    seenEpoch.current = resetEpoch
    setDraft(null)
  }, [resetEpoch])

  // Drop the draft when the committed value changes externally (e.g. a
  // Discard action restores the requested snapshot). Without this, the input
  // would keep rendering the user's stale typed text until they
  // focus-and-blur the field. lastCommittedFromHere tracks the value the
  // hook itself last produced, so a self-driven update (handleChange
  // calling onChange) is recognized as ours and leaves the draft alone;
  // any other transition is treated as external and clears the draft.
  // The seenValue guard matters twice over: it keeps a retain reopen from
  // clearing the draft, and it keeps that reopen from consuming the
  // lastCommittedFromHere tag, which would otherwise leave the NEXT reopen
  // looking like an external change and clear the draft through this path.
  const lastCommittedFromHere = useRef<number | null>(null)
  const seenValue = useRef(value)
  useEffect(() => {
    if (seenValue.current === value) return
    seenValue.current = value
    if (lastCommittedFromHere.current === value) {
      lastCommittedFromHere.current = null
      return
    }
    setDraft(null)
  }, [value])

  return {
    display: draft ?? String(value),
    handleChange: (raw) => {
      setDraft(raw)
      const next = commitNumberDraft(raw, options)
      // Tag this committed value so the external-change-detector recognizes
      // the next render's `value` as ours and leaves the draft in place.
      lastCommittedFromHere.current = next
      onChange(next)
    },
    handleBlur: () => setDraft(null)
  }
}
