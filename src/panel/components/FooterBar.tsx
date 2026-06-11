/**
 * Panel footer: the Save and Discard controls plus a dirty / just-saved
 * indicator. Both buttons are disabled while the configuration is unchanged.
 */

import type * as React from 'react'
import { memo } from 'react'
import SaveStatus from './SaveStatus.js'
import { S } from '../styles.js'

interface Props {
  dirty: boolean
  /** Epoch milliseconds of the last successful save, or null. Drives the "Saved" pill. */
  justSavedAt: number | null
  onSave: () => void
  onDiscard: () => void
}

/**
 * The configuration panel's footer bar. Memoized: the panel root keeps the
 * two callbacks identity-stable, so a keystroke in a field re-renders the
 * footer only when the dirty flag actually flips.
 */
export default memo(function FooterBar ({ dirty, justSavedAt, onSave, onDiscard }: Props): React.ReactElement {
  return (
    <div style={S.footer}>
      <button type='button' style={S.btnPrimary} onClick={onSave} disabled={!dirty}>
        Save
      </button>
      <button type='button' style={S.btnSecondary} onClick={onDiscard} disabled={!dirty}>
        Discard
      </button>
      <SaveStatus dirty={dirty} justSavedAt={justSavedAt} />
    </div>
  )
})
