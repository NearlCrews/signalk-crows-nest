/**
 * Pure logic for a tri-state select-all checkbox over a group of toggles.
 *
 * Extracted from SelectAllCheckbox so it can be unit-tested without a React
 * renderer, following the footer-bar-state pattern.
 */

/** The visual state a select-all checkbox should render. */
export interface SelectAllState {
  /** Fully selected: every toggle in the group is on. */
  checked: boolean
  /** Partially selected: some but not all toggles are on. */
  indeterminate: boolean
}

/** Derive the checkbox state from how many of the group's toggles are on. */
export function selectAllState (checkedCount: number, total: number): SelectAllState {
  return {
    checked: total > 0 && checkedCount === total,
    indeterminate: checkedCount > 0 && checkedCount < total
  }
}

/**
 * What a click should set every toggle to: on unless the group is already
 * fully selected, so an indeterminate click completes the selection and only
 * a fully-selected click clears it.
 */
export function selectAllTarget (checkedCount: number, total: number): boolean {
  return !(total > 0 && checkedCount === total)
}
