/**
 * Status snapshot shared between the plugin and its configuration panel.
 *
 * The plugin produces a StatusSnapshot from observed request outcomes; the
 * panel polls it through the admin-gated status endpoint. Keeping the type in
 * its own module lets both the Node build and the panel build import it
 * without pulling in unrelated code.
 */

/** A single recorded error, with the time it occurred. */
export interface StatusError {
  /** ISO-8601 timestamp of when the error was recorded. */
  at: string
  /** Human-readable error message. */
  message: string
  /**
   * Slug of the source the error was recorded against, when known. The
   * panel uses it to make the listed error a jump-to-card shortcut.
   */
  source?: string
}

/** The most recent successful list fetch from a POI source. */
export interface LastListFetch {
  /** ISO-8601 timestamp of the fetch. */
  at: string
  /** Number of points of interest the fetch returned. */
  poiCount: number
}

/** Why a source most recently declined or deferred a request. */
export interface LastSkip {
  /** Human-readable explanation, e.g. `outside US waters`. */
  reason: string
  /**
   * True when the skip is a transient deferral rather than a deliberate gate:
   * a list request that outran the aggregate's per-source timeout and will be
   * served from cache on the next refresh. The panel renders a transient skip
   * as waiting rather than idle, so a merely slow source does not read as
   * intentionally quiet.
   */
  transient: boolean
}

/** Health of one enabled POI data source. */
export interface SourceStatus {
  /** Source slug, e.g. `activecaptain`. */
  source: string
  /** Human-readable source name. */
  name: string
  /**
   * Whether the source's last request succeeded. Null until the source has
   * made its first request. Derived passively, with no extra API traffic.
   */
  apiReachable: boolean | null
  /** The source's most recent successful list fetch, or null if none has happened. */
  lastListFetch: LastListFetch | null
  /**
   * Why the source most recently declined or deferred a request, or null when
   * the source is not currently skipping. Cleared the moment a real request
   * succeeds or fails, so a set value means the source's last recorded action
   * was a skip. The panel surfaces it as an idle or waiting explanation so a
   * quiet source does not read as broken.
   */
  lastSkip: LastSkip | null
}

/** A point-in-time view of the plugin's health, served to the config panel. */
export interface StatusSnapshot {
  /** Health of each enabled POI source, in registration order. */
  sources: SourceStatus[]
  /** Number of point-of-interest detail entries currently cached. */
  cachedPoiCount: number
  /** The most recent errors, newest first, capped at a small fixed count. */
  recentErrors: StatusError[]
  /** ISO-8601 timestamp of when the plugin most recently started. */
  startedAt: string
}
