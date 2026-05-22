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
 * Coercion of the admin UI's untyped `configuration` prop into a fully
 * populated PluginConfig. Kept React-free so it can be unit-tested directly.
 */

import { POI_TYPE_FLAGS } from '../poiTypeSelection.js'
import type { PluginConfig } from '../types.js'

/**
 * Fallback caching duration. Mirrors DEFAULT_CACHING_DURATION_MINUTES in
 * src/index.ts; keep the two in step so the panel and the plugin agree.
 */
export const DEFAULT_CACHE_DURATION_MINUTES = 60

/**
 * Coerce the admin UI's untyped `configuration` prop into a fully populated
 * PluginConfig. A POI-type flag absent from the stored config defaults to
 * true, matching the plugin schema, so a never-configured plugin shows every
 * type enabled rather than appearing to import nothing. A non-positive or
 * non-numeric cache duration falls back to the default.
 */
export function normaliseConfig (configuration: unknown): PluginConfig {
  const raw = (typeof configuration === 'object' && configuration !== null)
    ? configuration as Record<string, unknown>
    : {}

  const minutes = raw.cachingDurationMinutes
  const config: PluginConfig = {
    cachingDurationMinutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_CACHE_DURATION_MINUTES
  }
  for (const [flag] of POI_TYPE_FLAGS) {
    config[flag] = raw[flag] !== false
  }
  return config
}
