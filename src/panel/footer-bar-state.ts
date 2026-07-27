/**
 * Pure logic for the Save button's disabled state.
 *
 * Extracted from FooterBar so it can be unit-tested without a React renderer.
 *
 * Rules:
 * - Enabled when the plugin is unconfigured (never saved, counting a save
 *   made in this session), so the user can save defaults to enable the plugin.
 * - Enabled when the working state differs from the last-saved snapshot
 *   (dirty), so a pending edit can always be committed.
 * - Disabled otherwise: a configured plugin with no pending edits has
 *   nothing to save.
 */

/**
 * Returns true when the Save button should be disabled.
 *
 * @param dirty - Whether the working state differs from the last saved snapshot.
 * @param unconfigured - Whether the plugin has never been saved, counting a
 *   save made in this session.
 */
export function saveButtonDisabled (dirty: boolean, unconfigured: boolean): boolean {
  return !dirty && !unconfigured
}
