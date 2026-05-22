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
 * Panel footer: the Save and Discard controls plus a dirty / just-saved
 * indicator. Both buttons are disabled while the configuration is unchanged.
 */

import type * as React from 'react'
import { S } from '../styles.js'

interface Props {
  dirty: boolean
  /** Epoch milliseconds of the last successful save, or null. Drives the "Saved" pill. */
  justSavedAt: number | null
  onSave: () => void
  onDiscard: () => void
}

/** The configuration panel's footer bar. */
export default function FooterBar ({ dirty, justSavedAt, onSave, onDiscard }: Props): React.ReactElement {
  return (
    <div style={S.footer}>
      <button type='button' style={S.btnPrimary} onClick={onSave} disabled={!dirty}>
        Save
      </button>
      <button type='button' style={S.btnSecondary} onClick={onDiscard} disabled={!dirty}>
        Discard
      </button>
      {dirty
        ? <span style={S.dirty}>Unsaved changes</span>
        : justSavedAt !== null
          ? <span role='status' style={S.savedPill}>Saved</span>
          : null}
    </div>
  )
}
