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
 * Number input for the cachingDurationMinutes setting. It holds a raw-text
 * draft while the user edits, so the field can be cleared mid-edit instead of
 * snapping back to a number on every keystroke, and commits a clamped, whole
 * number of minutes.
 */

import type * as React from 'react'
import { useState } from 'react'
import { S } from '../styles.js'

/** Stable id linking the visible label to its input. */
const FIELD_ID = 'ac-cache-duration'

/** Smallest cache duration the plugin accepts: it requires a positive value. */
const MIN_MINUTES = 1

interface Props {
  value: number
  onChange: (minutes: number) => void
}

/** The cache-duration field shown in the configuration panel. */
export default function CacheDurationField ({ value, onChange }: Props): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (raw: string): void => {
    if (raw.trim() === '') {
      onChange(MIN_MINUTES)
      return
    }
    const parsed = Number(raw)
    onChange(Number.isFinite(parsed) ? Math.max(MIN_MINUTES, Math.trunc(parsed)) : MIN_MINUTES)
  }

  return (
    <div style={S.fieldRow}>
      <label htmlFor={FIELD_ID} style={S.label}>Cache duration (minutes)</label>
      <input
        id={FIELD_ID}
        type='number'
        min={MIN_MINUTES}
        style={S.input}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => setDraft(null)}
      />
      <p style={S.hint}>
        How long imported ActiveCaptain data is cached. Longer means less data
        traffic, shorter means fresher data.
      </p>
    </div>
  )
}
