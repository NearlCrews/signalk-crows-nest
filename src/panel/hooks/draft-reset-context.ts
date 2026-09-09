/**
 * Epoch counter the panel root bumps on every Discard. Each numeric field
 * passes it to the shared `NumberField` as `resetKey`, which drops the
 * in-progress draft when the key changes.
 *
 * Why the field's own external-change rule is not enough: Discard restores the
 * requested snapshot, and a field whose committed value is already identical
 * to the requested value sees no `value` change, so a stale draft string (for
 * example a typed "0" that clamped to the committed 1) would stay on screen.
 * Chromium masks this because clicking the Discard button blurs the input
 * first, but WebKit does not move focus on button clicks, so the stale draft
 * survives there.
 *
 * A context reaches every draft-backed field without threading a prop through
 * the memoized card tree, and unlike a key-based remount it preserves focus
 * and disclosure state.
 */

import { createContext, useContext } from 'react'

/** Increments on every Discard; the initial epoch 0 means "no discard yet". */
export const DraftResetContext = createContext(0)

/** The current Discard epoch, for a `NumberField`'s `resetKey`. */
export function useDraftResetKey (): number {
  return useContext(DraftResetContext)
}
