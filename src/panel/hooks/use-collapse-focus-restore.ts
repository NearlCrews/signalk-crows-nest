/**
 * Focus restore for a collapsible region whose hidden state uses `display: none`.
 *
 * When a region collapses, the `display: none` flip pulls any focused descendant
 * out of the layout and the browser drops focus to `document.body`, so a keyboard
 * user loses their place and has to re-tab from the top of the panel. This hook
 * returns refs for the body region and the disclosure button plus
 * `restoreFocusBeforeCollapse`, which the caller invokes right before collapsing:
 * when focus is currently inside the body it moves focus back to the button.
 * Shared by SectionBox and DataSourceCard so the two collapsible patterns behave
 * identically rather than only SectionBox restoring focus.
 */

import { useCallback, useRef, type RefObject } from 'react'

/** Refs and the pre-collapse focus-restore callback for a collapsible region. */
export interface CollapseFocusRestore<B extends HTMLElement, T extends HTMLElement> {
  /** Attach to the collapsible body region. */
  bodyRef: RefObject<B | null>
  /** Attach to the disclosure button that toggles the region. */
  buttonRef: RefObject<T | null>
  /** Call immediately before collapsing the region. */
  restoreFocusBeforeCollapse: () => void
}

/** Wire focus restore for a collapsible region. See the module comment. */
export function useCollapseFocusRestore<
  B extends HTMLElement = HTMLDivElement,
  T extends HTMLElement = HTMLButtonElement
> (): CollapseFocusRestore<B, T> {
  const bodyRef = useRef<B | null>(null)
  const buttonRef = useRef<T | null>(null)
  const restoreFocusBeforeCollapse = useCallback((): void => {
    const body = bodyRef.current
    if (body === null) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && body.contains(focused)) {
      buttonRef.current?.focus()
    }
  }, [])
  return { bodyRef, buttonRef, restoreFocusBeforeCollapse }
}
