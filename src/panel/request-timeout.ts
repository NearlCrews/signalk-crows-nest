/**
 * The panel-wide per-request timeout shared by the status poller and the
 * unit-preferences fetch ladder, so the two budgets cannot drift apart.
 *
 * The status poller runs every 5 s, but its in-flight guard skips ticks while a
 * request is active, so this timeout can be longer than the poll interval
 * without stacking requests or accepting out-of-order responses. Fifteen
 * seconds leaves room for satellite, mobile, and other high-latency marine
 * connections before a request is abandoned.
 */
export const PANEL_REQUEST_TIMEOUT_MS = 15000
