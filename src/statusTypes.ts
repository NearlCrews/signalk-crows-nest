/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
}

/** The most recent successful list fetch from the ActiveCaptain API. */
export interface LastListFetch {
  /** ISO-8601 timestamp of the fetch. */
  at: string
  /** Number of points of interest the fetch returned. */
  poiCount: number
}

/** A point-in-time view of the plugin's health, served to the config panel. */
export interface StatusSnapshot {
  /**
   * Whether the last ActiveCaptain request succeeded. Null until the plugin
   * has made its first request. Derived passively, with no extra API traffic.
   */
  apiReachable: boolean | null
  /** The most recent successful list fetch, or null if none has happened. */
  lastListFetch: LastListFetch | null
  /** Number of point-of-interest detail entries currently cached. */
  cachedPoiCount: number
  /** The most recent errors, newest first, capped at a small fixed count. */
  recentErrors: StatusError[]
  /** ISO-8601 timestamp of when the plugin most recently started. */
  startedAt: string
}
