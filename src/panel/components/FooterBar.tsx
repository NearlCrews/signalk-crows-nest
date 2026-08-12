/**
 * Panel footer: the Save and Discard controls plus a dirty or requested
 * indicator. Save is disabled when the configuration is unchanged AND the
 * plugin has already been configured at least once. When the host supplies no
 * configuration, Save stays enabled so the user can request the defaults
 * without making a throwaway edit first.
 */

import type * as React from 'react'
import { memo, useCallback, useRef } from 'react'
import { ActionBar, Button } from 'signalk-nearlcrews-ui'
import SaveStatus from './SaveStatus.js'
import { saveButtonDisabled } from '../footer-bar-state.js'

interface Props {
  dirty: boolean
  /**
   * True while the host has supplied no configuration and this session has
   * issued no save request. Save stays enabled so the user can request the
   * defaults.
   */
  unconfigured: boolean
  /** Epoch milliseconds of the last save request, or null. */
  saveRequestedAt: number | null
  onSave: () => void
  onDiscard: () => void
}

/**
 * The configuration panel's footer bar. Memoized: the panel root keeps the
 * two callbacks identity-stable, so a keystroke in a field re-renders the
 * footer only when the dirty flag or unconfigured state actually flips.
 */
export default memo(function FooterBar ({ dirty, unconfigured, saveRequestedAt, onSave, onDiscard }: Props): React.ReactElement {
  const saveDisabled = saveButtonDisabled(dirty, unconfigured)
  const statusRef = useRef<HTMLDivElement>(null)
  const runAndFocusStatus = useCallback((action: () => void): void => {
    action()
    requestAnimationFrame(() => statusRef.current?.focus())
  }, [])

  return (
    <ActionBar
      sticky='viewport-bottom'
      status={
        <div ref={statusRef} role='status' aria-live='polite' tabIndex={-1}>
          <SaveStatus
            dirty={dirty}
            unconfigured={unconfigured}
            saveRequestedAt={saveRequestedAt}
          />
        </div>
      }
      actions={
        <>
          <Button
            variant='primary'
            onClick={() => runAndFocusStatus(onSave)}
            disabled={saveDisabled}
          >
            Save
          </Button>
          <Button onClick={() => runAndFocusStatus(onDiscard)} disabled={!dirty}>Discard</Button>
        </>
      }
    />
  )
})
