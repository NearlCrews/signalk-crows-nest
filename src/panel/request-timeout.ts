/**
 * The panel-wide per-request timeout shared by the status poller and the
 * unit-preferences fetch ladder, so the two budgets cannot drift apart.
 *
 * The binding constraint is the poller's: the timeout must stay below its
 * 5 s poll interval so a hung request clears before the next tick rather
 * than letting requests pile up.
 */
export const PANEL_REQUEST_TIMEOUT_MS = 4000
