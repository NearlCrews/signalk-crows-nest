/**
 * Epoch counter the panel root bumps on every Discard. Each `useNumberDraft`
 * instance watches it and drops its raw-text draft when it changes.
 *
 * Why the value-change detector in `useNumberDraft` is not enough: Discard
 * restores the saved snapshot, and a field whose committed value is already
 * identical to the saved value sees no `value` change, so its effect does not
 * re-run and a stale draft string (for example a typed "0" that clamped to
 * the committed 1) would stay on screen. Chromium masks this because clicking
 * the Discard button blurs the input first, but WebKit does not move focus on
 * button clicks, so the stale draft survives there.
 *
 * A context reaches every draft-backed field without threading a prop through
 * the memoized card tree, and unlike a key-based remount it preserves focus
 * and disclosure state.
 */

import { createContext } from 'react'

/** Increments on every Discard; the initial epoch 0 means "no discard yet". */
export const DraftResetContext = createContext(0)
