/**
 * Inline-style design tokens for the federated configuration panel.
 *
 * The panel renders inside the Signal K admin UI. Inline styles cannot
 * read the host's theme, so every color here references an `--ac-*` CSS
 * custom property rather than a hex literal. THEME_STYLE (below) defines
 * those properties once on `.ac-config-panel` with explicit light values.
 * It also carries an opportunistic dark-mode override block keyed on
 * `[data-bs-theme="dark"]` and `.dark-mode`: the current SignalK admin
 * does not set either selector (the dark block is dormant today), but
 * doing the work in tokens now means a future admin theme switcher will
 * light up the panel with no code change.
 *
 * Surfaces are deliberately NOT derived from the host's `--bs-body-bg`:
 * the admin's body background is page-gray, so a card that inherited it
 * would lose its white fill. Components stay theme-agnostic: they read
 * tokens, the theme layer redefines them.
 */

import type { CSSProperties } from 'react'

/**
 * Injected once by PluginConfigurationPanel. Defines the token contract,
 * the dark-mode overrides, and the pseudo-class states (focus ring,
 * disabled buttons) that inline styles cannot express.
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
[data-bs-theme="dark"] .ac-config-panel,
.dark-mode .ac-config-panel {
  --ac-surface: #262833;
  --ac-surface-muted: #20212b;
  --ac-surface-raised: #30323f;
  --ac-border: #3a3c4a;
  --ac-text: #e6e7ea;
  --ac-text-muted: #a3a9b5;
  /* Bumped up from #7c8290 (3.80:1 on --ac-surface) to #9ba0ad (4.62:1)
     so the muted-faint text token clears WCAG AA at the smaller font
     sizes it lands on (the source-card chevron, status error times, the
     fieldset legend that titles every option group). */
  --ac-text-faint: #9ba0ad;
  --ac-accent: #4c93ff;
  --ac-ok: #2dd4a0;
  --ac-off: #6b7785;
  --ac-danger-bg: #3a1a1a;
  --ac-danger-fg: #f5a3a3;
  --ac-danger-border: #7a3a3a;
  --ac-success-bg: #12352a;
  --ac-success-fg: #7fe3c0;
  --ac-success-border: #2f6b54;
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
/* Pointer feedback for non-disabled buttons (the All/None bulk pills,
   the footer Save/Discard pair). Inline styles cannot express :hover;
   this rule keeps the affordance consistent across themes. */
.ac-config-panel button:not(:disabled):hover {
  background: var(--ac-surface-raised);
}
.ac-config-panel button:not(:disabled):active {
  background: var(--ac-border);
}
/* The browser-default <legend> layout cuts into the fieldset's top border,
   producing a visible notch in the rounded border. Floating the legend
   lifts it out of the border into a normal block above the fieldset
   contents; the next sibling clears the float so it begins on a new line. */
.ac-config-panel fieldset > legend {
  float: left;
  width: 100%;
  margin: 0 0 8px;
  padding: 0;
}
.ac-config-panel fieldset > legend + * {
  clear: both;
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

  // Status bar at the top of the panel: a vertical stack with the
  // section title, a per-source health grid, and any recent errors. No
  // numeric POI counts: the count from a single bbox query is contextual
  // to that query and reads as misleading in an at-a-glance indicator.
  statusBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '12px 14px',
    background: 'var(--ac-surface-muted)',
    border: '1px solid var(--ac-border)',
    borderRadius: 10,
    marginBottom: 16,
    fontSize: 13
  },
  statusBarTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--ac-text)'
  },
  /**
   * Wrapper for the variable body of the status bar (loading line OR
   * the per-source health grid OR the empty-state copy). The
   * min-height reserves space for ~4 grid rows so the bar does not
   * visibly grow when the first status poll resolves and swaps a
   * one-line loading state for the multi-row grid.
   */
  statusBarBody: {
    minHeight: 80
  },
  statusBarLoading: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--ac-text-muted)'
  },
  statusBarEmpty: {
    color: 'var(--ac-text-muted)'
  },
  // Per-source health grid: four columns (dot, name, state, last fetch).
  // One row per source so the columns align across sources and the eye
  // can scan a single field down the list. The name column uses
  // `minmax(0, auto)` so a long source name (NOAA ENC's ~50 char title)
  // can shrink and ellipsize on a narrow Signal K admin sidebar
  // instead of forcing horizontal overflow on the whole bar.
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, auto) auto 1fr',
    columnGap: 12,
    rowGap: 4,
    alignItems: 'center'
  },
  // Each SourceRow wraps its four cells in a `display: contents` div so the
  // grid still places the cells in its four columns while the wrapper itself
  // does not participate in layout. The wrapper pins the 4-cells contract: a
  // future fifth cell would land outside this row, making the drift visible.
  // No ARIA role is applied here (see SourceRow): the status bar is a passive
  // health readout, not an interactive data grid.
  statusGridRow: {
    display: 'contents'
  },
  statusGridName: {
    fontWeight: 600,
    color: 'var(--ac-text)',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  statusGridState: {
    color: 'var(--ac-text-muted)'
  },
  statusGridFetch: {
    color: 'var(--ac-text-muted)',
    textAlign: 'right'
  },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  dotOk: { background: 'var(--ac-ok)' },
  dotOff: { background: 'var(--ac-off)' },
  dotError: { background: 'var(--ac-danger-fg)' },
  statusErrors: {
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

  // Generic field row: a label-input pair laid out as one row, with the
  // hint rendered as a sibling block below (NumberField composes the two
  // via the S.hintBelow variant). Labels are a fixed-width muted column
  // on the left, so successive rows visually align without depending on
  // label length.
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 4
  },
  label: {
    fontSize: 13,
    color: 'var(--ac-text-muted)',
    width: 220,
    flexShrink: 0
  },
  input: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--ac-border)',
    background: 'var(--ac-surface)',
    color: 'var(--ac-text)',
    fontSize: 13,
    width: 110
  },
  /**
   * Default hint paragraph style. Used by callers that supply their own
   * outer container spacing (toggle hints inside AlarmFieldset, the
   * rationale paragraph in MergeWithActiveCaptain, the empty-state hints
   * in fieldset bodies). Defaults to `margin: 0` so a hint nested inside
   * a labeled group inherits the group's vertical rhythm and does NOT
   * grow its own bottom margin.
   */
  hint: {
    fontSize: 12,
    color: 'var(--ac-text-muted)',
    lineHeight: 1.45,
    margin: 0
  },
  /**
   * Variant for a hint paragraph rendered immediately below a labeled
   * field row (the NumberField/EndpointUrlField/NoaaEnc band selector
   * shape). Adds 12px of bottom margin so successive fields visually
   * separate, while the bare `S.hint` token stays at `margin: 0` for
   * callers that supply their own surrounding spacing.
   */
  hintBelow: {
    fontSize: 12,
    color: 'var(--ac-text-muted)',
    lineHeight: 1.45,
    margin: '0 0 12px'
  },

  // Grouped-options sections: a header with bulk actions, and one fieldset
  // per group. Used by both the ActiveCaptain POI-type selector and the
  // OpenSeaMap seamark-group checklist.
  groupsSection: { marginBottom: 16 },
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
  /**
   * Inner-fieldset shell, used for the four POI-type sub-groups inside the
   * outer "Import layers" fieldset on the ActiveCaptain card. Trimmed
   * border and padding so a sub-group reads as a child of the outer
   * fieldset and not as a peer card.
   */
  subGroup: {
    background: 'var(--ac-surface)',
    border: '1px solid var(--ac-border)',
    borderRadius: 6,
    padding: '8px 12px',
    marginBottom: 8
  },
  subGroupTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--ac-text-muted)',
    margin: '0 0 6px'
  },
  /**
   * Inline cluster of bulk-action pill buttons (All / None), placed
   * inside the outer fieldset's legend so they sit next to the title.
   */
  bulkButtons: {
    display: 'inline-flex',
    gap: 6,
    marginLeft: 10,
    verticalAlign: 'middle'
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
    background: 'var(--ac-surface-muted)',
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
  // The body of an expanded source card. Lives on the same surface as the
  // header; the header padding plus this body padding align the content
  // columns so there is no nested-card look.
  sourceCardBody: {
    padding: '0 14px 6px',
    marginTop: 4
  },
  /**
   * Shared collapsed-body token: applied to a body region that should
   * stay mounted (so an in-progress NumberField draft survives) while
   * being hidden from layout and paint. Reused by both DataSourceCard
   * and SectionBox so the two collapsible patterns share one
   * hide-behavior primitive: a future change (e.g. switching to
   * `visibility: hidden`) lands in one place. The behavioral half,
   * restoring focus to the disclosure button before collapse, is shared
   * too, via the `useCollapseFocusRestore` hook both components consume.
   */
  collapsedBody: {
    display: 'none'
  },

  /**
   * Outer container for a top-level panel section (Data sources,
   * Alerts). A single bordered box that wraps both the disclosure
   * header and the section body, so the data-source cards and the
   * alarm fieldsets read as contained inside their section rather
   * than as loose siblings of a heading.
   */
  sectionBox: {
    background: 'var(--ac-surface-muted)',
    border: '1px solid var(--ac-border)',
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden'
  },
  /**
   * Wrapper for the disclosure button: the outer element is an `<h2>`
   * so screen readers expose the section title as a real heading
   * landmark (H key / VO+Cmd+H navigation lands on it). The browser's
   * default h2 margin and font scale are overridden here so the
   * heading reads as a button row, not as a large typographic header.
   */
  sectionBoxHeading: {
    margin: 0,
    padding: 0,
    fontSize: 14,
    fontWeight: 600
  },
  sectionBoxHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '10px 14px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--ac-text)',
    font: 'inherit'
  },
  sectionBoxTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--ac-text)',
    flex: 1,
    minWidth: 0
  },
  sectionBoxChevron: {
    fontSize: 12,
    color: 'var(--ac-text-faint)',
    flexShrink: 0
  },
  sectionBoxBody: {
    padding: '0 12px 12px',
    background: 'var(--ac-surface-muted)'
  },

  // A compact pill rendered inside a source-card header to surface live
  // per-source health (idle / ok / error) so a collapsed card still tells
  // the operator what is happening. It never shows a per-fetch POI count:
  // a rolling count reads as broken when the chart simply has not panned
  // to anywhere with markers. The count lives in the hover title only.
  sourceStatusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: 'var(--ac-text-muted)',
    background: 'var(--ac-surface-muted)',
    border: '1px solid var(--ac-border)',
    borderRadius: 999,
    padding: '2px 8px',
    flexShrink: 0
  },
  sourceStatusPillError: {
    color: 'var(--ac-danger-fg)',
    background: 'var(--ac-danger-bg)',
    borderColor: 'var(--ac-danger-border)'
  },
  // Idle (no list fetch yet) variant. Visually de-emphasized so it cannot
  // be confused with the success variant; the muted color and dotted-line
  // ellipsis glyph together signal "waiting" rather than "good".
  sourceStatusPillIdle: {
    color: 'var(--ac-text-faint)'
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
