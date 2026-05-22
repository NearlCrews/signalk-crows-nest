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
 * Inline-style design tokens for the federated configuration panel.
 *
 * The panel renders inside the Signal K admin UI, which owns the page. Inline
 * styles cannot read the host's theme, so every colour here references an
 * `--ac-*` CSS custom property rather than a hex literal. THEME_STYLE (below)
 * defines those properties once on `.ac-config-panel` with explicit values, so
 * a card surface never inherits the admin's gray page background and dissolve
 * into it. Dark and night-red theming are intentionally out of scope for this
 * release, so only a single light palette is defined.
 */

import type { CSSProperties } from 'react'

/**
 * Injected once by PluginConfigurationPanel. Defines the token contract and the
 * pseudo-class states (focus ring, disabled buttons) that inline styles cannot
 * express.
 */
export const THEME_STYLE = `
.ac-config-panel {
  --ac-surface: #ffffff;
  --ac-surface-muted: #f8f9fa;
  --ac-surface-raised: #f1f3f5;
  --ac-border: #e0e0e0;
  --ac-text: #333333;
  --ac-text-muted: #555555;
  --ac-text-faint: #888888;
  --ac-accent: #3b82f6;
  --ac-accent-text: #ffffff;
  --ac-ok: #22c55e;
  --ac-off: #9ca3af;
  --ac-danger-bg: #fef2f2;
  --ac-danger-fg: #991b1b;
  --ac-danger-border: #fca5a5;
  --ac-success-bg: #ecfdf5;
  --ac-success-fg: #065f46;
  --ac-success-border: #6ee7b7;
}
.ac-config-panel input:focus-visible,
.ac-config-panel button:focus-visible {
  outline: 2px solid var(--ac-accent);
  outline-offset: 1px;
}
.ac-config-panel button:disabled {
  background: var(--ac-surface-raised) !important;
  color: var(--ac-text-faint) !important;
  border-color: var(--ac-border) !important;
  cursor: not-allowed !important;
}
`

export const S: Record<string, CSSProperties> = {
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: 'var(--ac-text)',
    padding: '16px 0'
  },

  // Status bar.
  statusBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 18,
    padding: '12px 16px',
    background: 'var(--ac-surface-muted)',
    border: '1px solid var(--ac-border)',
    borderRadius: 10,
    marginBottom: 16,
    fontSize: 13
  },
  statusApi: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  dotOk: { background: 'var(--ac-ok)' },
  dotOff: { background: 'var(--ac-off)' },
  dotError: { background: 'var(--ac-danger-fg)' },
  statLabel: { color: 'var(--ac-text-muted)' },
  statValue: { fontWeight: 600, marginLeft: 4 },
  statusErrors: {
    flexBasis: '100%',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 4
  },
  statusErrorItem: {
    display: 'flex',
    gap: 8,
    fontSize: 12,
    color: 'var(--ac-danger-fg)',
    background: 'var(--ac-danger-bg)',
    border: '1px solid var(--ac-danger-border)',
    borderRadius: 4,
    padding: '4px 8px'
  },
  statusErrorTime: { color: 'var(--ac-text-faint)', flexShrink: 0 },

  // Cache duration field.
  fieldRow: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16
  },
  label: { fontSize: 13, fontWeight: 600, color: 'var(--ac-text)' },
  input: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--ac-border)',
    background: 'var(--ac-surface)',
    color: 'var(--ac-text)',
    fontSize: 13,
    width: 110
  },
  hint: {
    fontSize: 12,
    color: 'var(--ac-text-muted)',
    lineHeight: 1.45,
    margin: 0
  },

  // POI-type groups.
  groupsSection: { marginBottom: 16 },
  groupsHeader: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8
  },
  groupsTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ac-text)', marginRight: 4 },
  btnBulk: {
    padding: '4px 12px',
    background: 'var(--ac-surface-raised)',
    color: 'var(--ac-text)',
    border: '1px solid var(--ac-border)',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer'
  },
  group: {
    background: 'var(--ac-surface)',
    border: '1px solid var(--ac-border)',
    borderRadius: 10,
    padding: '12px 16px',
    marginBottom: 10
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: 'var(--ac-text-faint)',
    margin: '0 0 8px'
  },
  checkboxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 6
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--ac-text)',
    cursor: 'pointer'
  },
  checkbox: { width: 16, height: 16, flexShrink: 0, cursor: 'pointer' },

  // Footer.
  footer: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 0',
    borderTop: '1px solid var(--ac-border)',
    marginTop: 8
  },
  btnPrimary: {
    padding: '8px 16px',
    background: 'var(--ac-accent)',
    color: 'var(--ac-accent-text)',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnSecondary: {
    padding: '8px 16px',
    background: 'var(--ac-surface-raised)',
    color: 'var(--ac-text)',
    border: '1px solid var(--ac-border)',
    borderRadius: 6,
    cursor: 'pointer'
  },
  dirty: { fontSize: 12, color: 'var(--ac-text-muted)', marginLeft: 4 },
  savedPill: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 12,
    lineHeight: 1,
    color: 'var(--ac-success-fg)',
    background: 'var(--ac-success-bg)',
    border: '1px solid var(--ac-success-border)',
    borderRadius: 999,
    padding: '5px 12px',
    marginLeft: 4
  },

  // Non-fatal status-poll error banner.
  errorBanner: {
    color: 'var(--ac-danger-fg)',
    background: 'var(--ac-danger-bg)',
    border: '1px solid var(--ac-danger-border)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    margin: '0 0 16px'
  }
}
