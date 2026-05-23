/**
 * Inline-style design tokens for the federated configuration panel.
 *
 * The panel renders inside the Signal K admin UI, which owns the page. Inline
 * styles cannot read the host's theme, so every color here references an
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
.ac-config-panel button:disabled,
.ac-config-panel input:disabled,
.ac-config-panel select:disabled {
  background: var(--ac-surface-raised) !important;
  color: var(--ac-text-faint) !important;
  border-color: var(--ac-border) !important;
  cursor: not-allowed !important;
}
`

/**
 * The named style tokens consumed by panel components. Declared with a
 * `satisfies` clause so each value is checked as a CSSProperties literal while
 * the inferred type of `S` keeps its specific keys: indexing `S.unknownKey`
 * remains a TypeScript error, which a `Record<string, CSSProperties>`
 * annotation would have silently allowed.
 */
export const S = {
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: 'var(--ac-text)',
    padding: '16px 0'
  },

  // Status bar at the top of the panel.
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

  // Generic field row: label, control, and a hint laid out in a flow row.
  // Used by every single-value numeric and text input.
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

  // Grouped-options sections: a header with bulk actions, and one fieldset
  // per group. Used by both the ActiveCaptain POI-type selector and the
  // OpenSeaMap seamark-group checklist.
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

  // Generic checkbox row: a clickable label wrapping a single checkbox.
  // Used by toggle controls anywhere on the panel.
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--ac-text)',
    cursor: 'pointer',
    marginBottom: 8
  },
  // Generic labelled-input row: a label, a numeric control, and a hint, laid
  // out below a toggle in an alarm fieldset.
  labelledInputRow: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12
  },

  // Data-source accordion cards.
  sourceCard: {
    background: 'var(--ac-surface)',
    border: '1px solid var(--ac-border)',
    borderRadius: 10,
    marginBottom: 10
  },
  sourceCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px'
  },
  alwaysOnBadge: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    color: 'var(--ac-text-muted)',
    background: 'var(--ac-surface-muted, rgba(255,255,255,0.05))',
    border: '1px solid var(--ac-border)',
    borderRadius: 3,
    padding: '2px 6px',
    flexShrink: 0
  },
  sourceCardToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--ac-text)',
    font: 'inherit'
  },
  sourceCardName: { fontSize: 14, fontWeight: 600, color: 'var(--ac-text)', flexShrink: 0 },
  sourceCardSummary: {
    fontSize: 12,
    color: 'var(--ac-text-muted)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  sourceCardChevron: { fontSize: 11, color: 'var(--ac-text-faint)', flexShrink: 0 },
  // The body of an expanded source card. The left border + left padding +
  // left margin form a visible left-side accent rule that makes it obvious
  // the body fields are children of the source-name header above. Padding
  // and margin alone read as a generic indent; the border closes the gap
  // between the parent's chevron and the child fields.
  sourceCardBody: {
    padding: '14px 14px 4px 22px',
    borderTop: '1px solid var(--ac-border)',
    borderLeft: '3px solid var(--ac-border)',
    marginLeft: 10
  },

  // Panel section heading (Data sources, Alerts).
  sectionHeading: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--ac-text-faint)',
    margin: '20px 0 10px'
  },

  // Wide text input, for values such as a URL.
  inputWide: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--ac-border)',
    background: 'var(--ac-surface)',
    color: 'var(--ac-text)',
    fontSize: 13,
    width: '100%',
    maxWidth: 440,
    boxSizing: 'border-box'
  },

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
} satisfies Record<string, CSSProperties>
