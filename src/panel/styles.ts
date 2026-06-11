/**
 * Inline-style design tokens for the federated configuration panel.
 *
 * The panel renders inside the Signal K admin UI. Inline styles cannot
 * read the host's theme, so every color here references an `--ac-*` CSS
 * custom property rather than a hex literal. THEME_STYLE (below) defines
 * those properties once on `.ac-config-panel` with explicit light values,
 * then overrides them per theme. Components stay theme-agnostic: they
 * read tokens, the theme layer redefines them. A new hex literal in a
 * component is a defect.
 *
 * Theme pinning: a `data-ac-theme` attribute on the `.ac-config-panel`
 * root (set by ThemeToggle, persisted under localStorage key `ac-theme`)
 * pins light, dark, or the red-preserving night theme. The pinned blocks
 * share specificity with the host-driven dark block and are emitted later
 * in the stylesheet, so a pinned choice wins. The host-driven block keyed
 * on `[data-bs-theme="dark"]` / `.dark-mode` is dormant today (the current
 * SignalK admin sets neither; verified against the server-admin-ui source),
 * so the ThemeToggle is the way a user actually gets dark or night mode.
 *
 * Surfaces are deliberately NOT derived from the host's `--bs-body-bg`:
 * the admin's body background is page-gray, so a card that inherited it
 * would lose its white fill.
 */

import type { CSSProperties } from 'react'

/**
 * Scale tokens: theme-independent, defined once on the root. Radii and
 * font sizes sit on Bootstrap 5.3 defaults (radius .375rem = 6px, small
 * text .875rem = 14px) so the panel reads native inside the admin shell,
 * and spacing runs an 8/12/16 scale so gutters stay on one rhythm. The
 * values mirror the sibling Emitter Cannon panel so the two plugins read
 * as one family.
 */
const SCALE_TOKENS = `
  --ac-radius: 6px;
  --ac-radius-sm: 4px;
  --ac-radius-pill: 999px;
  --ac-font-body: 14px;
  --ac-font-small: 12px;
  --ac-font-title: 15px;
  --ac-space-1: 8px;
  --ac-space-2: 12px;
  --ac-space-3: 16px;
`

/**
 * Light theme. Cards must read white so they stand out from the admin's
 * gray page background. Faint text is #62687a: 5.05:1 on the raised
 * surface, clearing WCAG AA (4.5:1) at the small sizes it is used at.
 * `color-scheme` rides along with each token block so native widgets
 * (checkboxes, select dropdown lists, number spinners, scrollbars) follow
 * the panel theme even when it is pinned against the host.
 */
const LIGHT_TOKENS = `
  color-scheme: light;
  --ac-bg: #e4e5e6;
  --ac-surface: #ffffff;
  --ac-surface-muted: #f8f9fa;
  --ac-surface-raised: #f1f3f5;
  --ac-border: #e0e0e0;
  --ac-text: #333333;
  --ac-text-muted: #555555;
  --ac-text-faint: #62687a;
  --ac-accent: #3b82f6;
  --ac-accent-text: #ffffff;
  --ac-ok: #22c55e;
  --ac-wait: #f59e0b;
  --ac-off: #9ca3af;
  --ac-danger-bg: #fef2f2;
  --ac-danger-fg: #991b1b;
  --ac-danger-border: #fca5a5;
  --ac-warn-bg: #fef3c7;
  --ac-warn-fg: #78350f;
  --ac-warn-border: #fbbf24;
  --ac-success-bg: #ecfdf5;
  --ac-success-fg: #065f46;
  --ac-success-border: #6ee7b7;
  --ac-info-bg: #eef2ff;
  --ac-info-fg: #3730a3;
  --ac-info-border: #c7d2fe;
`

/**
 * Dark theme. Faint text is #9ba0ad: 4.62:1 on the card surface, so AA
 * holds at the small sizes it lands on (the source-card chevron, status
 * error times, the fieldset legend that titles every option group).
 */
const DARK_TOKENS = `
  color-scheme: dark;
  --ac-bg: #1b1c22;
  --ac-surface: #262833;
  --ac-surface-muted: #20212b;
  --ac-surface-raised: #30323f;
  --ac-border: #3a3c4a;
  --ac-text: #e6e7ea;
  --ac-text-muted: #a3a9b5;
  --ac-text-faint: #9ba0ad;
  --ac-accent: #4c93ff;
  --ac-accent-text: #ffffff;
  --ac-ok: #2dd4a0;
  --ac-wait: #fbbf24;
  --ac-off: #6b7785;
  --ac-danger-bg: #3a1a1a;
  --ac-danger-fg: #f5a3a3;
  --ac-danger-border: #7a3a3a;
  --ac-warn-bg: #3a2f12;
  --ac-warn-fg: #f5d28a;
  --ac-warn-border: #6b551f;
  --ac-success-bg: #12352a;
  --ac-success-fg: #7fe3c0;
  --ac-success-border: #2f6b54;
  --ac-info-bg: #1e2547;
  --ac-info-fg: #a9b6f0;
  --ac-info-border: #3a4577;
`

/**
 * Night theme: red-preserving for night vision at the helm. Near-black
 * surfaces, every text and accent token collapses into the desaturated
 * red and amber families, nothing renders blue, green, or white. The
 * palette is shared with the Emitter Cannon panel, whose contrast audit
 * holds here too: text 7.25:1, muted 5.13:1, faint 4.56:1 worst case,
 * every status fg 5.65:1 or better on its paired bg.
 */
const NIGHT_TOKENS = `
  color-scheme: dark;
  --ac-bg: #0d0606;
  --ac-surface: #160a0a;
  --ac-surface-muted: #110808;
  --ac-surface-raised: #1f0e0e;
  --ac-border: #3a1616;
  --ac-text: #e08a8a;
  --ac-text-muted: #b87474;
  --ac-text-faint: #ad6c6c;
  --ac-accent: #cf6a3c;
  --ac-accent-text: #1a0808;
  --ac-ok: #cf8a4a;
  --ac-wait: #a9742e;
  --ac-off: #7a4f4f;
  --ac-danger-bg: #2a0d0d;
  --ac-danger-fg: #e07a6a;
  --ac-danger-border: #6e2a2a;
  --ac-warn-bg: #241204;
  --ac-warn-fg: #d9a05a;
  --ac-warn-border: #6e4a1f;
  --ac-success-bg: #1d0f08;
  --ac-success-fg: #cf8a5a;
  --ac-success-border: #6e3f1f;
  --ac-info-bg: #200c0c;
  --ac-info-fg: #c98080;
  --ac-info-border: #5e2a2a;
`

/**
 * Injected once by PluginConfigurationPanel. Covers the token contract,
 * the host-driven dark overrides, the pinned theme blocks, and the
 * pseudo-class states (focus ring, disabled buttons, hover and active
 * feedback) that inline styles cannot express. Order matters: the pinned
 * `[data-ac-theme]` blocks come after the host-driven dark block so an
 * explicit user choice outranks the host theme at equal specificity.
 */
export const THEME_STYLE = `
.ac-config-panel {
${SCALE_TOKENS}${LIGHT_TOKENS}}
[data-bs-theme="dark"] .ac-config-panel,
.dark-mode .ac-config-panel {
${DARK_TOKENS}}
.ac-config-panel[data-ac-theme="light"] {
${LIGHT_TOKENS}}
.ac-config-panel[data-ac-theme="dark"] {
${DARK_TOKENS}}
.ac-config-panel[data-ac-theme="night"] {
${NIGHT_TOKENS}}
.ac-config-panel input:focus-visible,
.ac-config-panel select:focus-visible,
.ac-config-panel textarea:focus-visible,
.ac-config-panel button:focus-visible {
  outline: 2px solid var(--ac-accent);
  outline-offset: 1px;
}
/* Buttons set their background as an inline style, which outranks the
   browser's default disabled appearance, so a disabled button would still
   look enabled. !important is required to override the inline style for
   the disabled state. */
.ac-config-panel button:disabled,
.ac-config-panel input:disabled,
.ac-config-panel select:disabled {
  background: var(--ac-surface-raised) !important;
  color: var(--ac-text-faint) !important;
  border-color: var(--ac-border) !important;
  cursor: not-allowed !important;
}
/* Pointer feedback. Inline styles cannot express :hover or :active, so the
   interactive elements get a shared brightness response here: a touch
   darker on hover, darker still while pressed, with a short transition so
   the shift reads as a response rather than a flicker. Brightness works on
   any background (including the accent-filled primary button), which a
   background swap could not. Disabled buttons opt out. */
.ac-config-panel input,
.ac-config-panel select,
.ac-config-panel textarea {
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.ac-config-panel button {
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    filter 120ms ease;
}
.ac-config-panel button:hover:not(:disabled) {
  filter: brightness(0.96);
}
.ac-config-panel button:active:not(:disabled) {
  filter: brightness(0.9);
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
 * Base segment button, spread into the active variant below. Each segment
 * is a 36px touch target, sized for wet fingers on a moving boat.
 */
const SEGMENTED_BTN: CSSProperties = {
  padding: '6px 12px',
  minHeight: 36,
  background: 'transparent',
  color: 'var(--ac-text-muted)',
  border: 'none',
  fontSize: 'var(--ac-font-small)',
  cursor: 'pointer'
}

/**
 * The named style tokens consumed by panel components. Declared with a
 * `satisfies` clause so each value is checked as a CSSProperties literal while
 * the inferred type of `S` keeps its specific keys: indexing `S.unknownKey`
 * remains a TypeScript error, which a `Record<string, CSSProperties>`
 * annotation would have silently allowed.
 *
 * Touch sizing stays as literals rather than tokens (22px checkboxes,
 * 36px minimum control heights): the values are accessibility floors, not
 * theme decisions, so a theme must not be able to shrink them.
 */
export const S = {
  // The root paints --ac-bg itself: a pinned Dark or Night theme must read
  // as one continuous surface, not dark cards floating on the host's light
  // page.
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: 'var(--ac-text)',
    background: 'var(--ac-bg)',
    padding: 'var(--ac-space-3)',
    borderRadius: 'var(--ac-radius)'
  },

  // The top control bar: the theme toggle, right-aligned so it reads as
  // panel chrome rather than as the first configuration field.
  controlBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: 'var(--ac-space-2)'
  },

  // Compact segmented control: a bordered fieldset of aria-pressed buttons
  // with the active segment filled by the accent.
  segmented: {
    display: 'inline-flex',
    // Rendered as a <fieldset>: zero out the user-agent margin and padding
    // so the segments sit flush inside the border.
    margin: 0,
    padding: 0,
    border: '1px solid var(--ac-border)',
    borderRadius: 'var(--ac-radius)',
    overflow: 'hidden',
    background: 'var(--ac-surface)'
  },
  segmentedBtn: SEGMENTED_BTN,
  segmentedBtnActive: {
    ...SEGMENTED_BTN,
    background: 'var(--ac-accent)',
    color: 'var(--ac-accent-text)',
    fontWeight: 600
  },

  // Visually hidden but screen-reader-readable, for the segmented
  // control's naming <legend>.
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: 0
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
    borderRadius: 'var(--ac-radius)',
    marginBottom: 'var(--ac-space-3)',
    fontSize: 'var(--ac-font-body)'
  },
  statusBarTitle: {
    fontSize: 'var(--ac-font-title)',
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
    fontSize: 'var(--ac-font-small)',
    color: 'var(--ac-danger-fg)',
    background: 'var(--ac-danger-bg)',
    border: '1px solid var(--ac-danger-border)',
    borderRadius: 'var(--ac-radius-sm)',
    padding: '4px 8px'
  },
  statusErrorTime: { color: 'var(--ac-text-faint)', flexShrink: 0 },

  // Generic field row: a label-input pair laid out as one row, with the
  // hint rendered as a sibling block below (LabeledField composes the two
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
    fontSize: 'var(--ac-font-body)',
    color: 'var(--ac-text-muted)',
    width: 220,
    flexShrink: 0
  },
  input: {
    padding: '6px 10px',
    minHeight: 36,
    boxSizing: 'border-box',
    borderRadius: 'var(--ac-radius)',
    border: '1px solid var(--ac-border)',
    background: 'var(--ac-surface)',
    color: 'var(--ac-text)',
    fontSize: 'var(--ac-font-body)',
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
    fontSize: 'var(--ac-font-small)',
    color: 'var(--ac-text-muted)',
    lineHeight: 1.45,
    margin: 0
  },
  /**
   * Variant for a hint paragraph rendered immediately below a labeled
   * field row (the LabeledField shape). Adds 12px of bottom margin so
   * successive fields visually separate, while the bare `S.hint` token
   * stays at `margin: 0` for callers that supply their own surrounding
   * spacing.
   */
  hintBelow: {
    fontSize: 'var(--ac-font-small)',
    color: 'var(--ac-text-muted)',
    lineHeight: 1.45,
    margin: '0 0 12px'
  },

  // Grouped-options sections: a header with bulk actions, and one fieldset
  // per group. Used by both the ActiveCaptain POI-type selector and the
  // OpenSeaMap seamark-group checklist.
  groupsSection: { marginBottom: 'var(--ac-space-3)' },
  btnBulk: {
    padding: '4px 12px',
    minHeight: 36,
    background: 'var(--ac-surface-raised)',
    color: 'var(--ac-text)',
    border: '1px solid var(--ac-border)',
    borderRadius: 'var(--ac-radius-pill)',
    fontSize: 'var(--ac-font-small)',
    cursor: 'pointer'
  },
  group: {
    background: 'var(--ac-surface)',
    border: '1px solid var(--ac-border)',
    borderRadius: 'var(--ac-radius)',
    padding: '12px 16px',
    marginBottom: 10
  },
  groupTitle: {
    fontSize: 'var(--ac-font-small)',
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
    borderRadius: 'var(--ac-radius-sm)',
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
    fontSize: 'var(--ac-font-body)',
    color: 'var(--ac-text)',
    cursor: 'pointer'
  },
  // 22px boxes with the accent check fill: sized for wet fingers at the
  // helm, and accentColor keeps the checked fill on-palette in every theme.
  checkbox: {
    width: 22,
    height: 22,
    flexShrink: 0,
    cursor: 'pointer',
    accentColor: 'var(--ac-accent)'
  },

  // Generic checkbox row: a clickable label wrapping a single checkbox.
  // Used by toggle controls anywhere on the panel.
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 'var(--ac-font-body)',
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
    borderRadius: 'var(--ac-radius)',
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
    borderRadius: 'var(--ac-radius-sm)',
    padding: '2px 6px',
    flexShrink: 0
  },
  sourceCardToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--ac-text)',
    font: 'inherit'
  },
  sourceCardName: {
    fontSize: 'var(--ac-font-title)',
    fontWeight: 600,
    color: 'var(--ac-text)',
    flexShrink: 0
  },
  sourceCardSummary: {
    fontSize: 'var(--ac-font-small)',
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
    borderRadius: 'var(--ac-radius)',
    marginBottom: 'var(--ac-space-3)',
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
    fontSize: 'var(--ac-font-title)',
    fontWeight: 600
  },
  sectionBoxHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 36,
    padding: '10px 14px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--ac-text)',
    font: 'inherit'
  },
  sectionBoxTitle: {
    fontSize: 'var(--ac-font-title)',
    fontWeight: 600,
    color: 'var(--ac-text)',
    flex: 1,
    minWidth: 0
  },
  sectionBoxChevron: {
    fontSize: 'var(--ac-font-small)',
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
    borderRadius: 'var(--ac-radius-pill)',
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
    minHeight: 36,
    borderRadius: 'var(--ac-radius)',
    border: '1px solid var(--ac-border)',
    background: 'var(--ac-surface)',
    color: 'var(--ac-text)',
    fontSize: 'var(--ac-font-body)',
    width: '100%',
    maxWidth: 440,
    boxSizing: 'border-box'
  },

  // Footer. Sticky, painting --ac-bg, so Save stays reachable on a long
  // panel and the row does not read as a translucent strip over content.
  footer: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 0',
    borderTop: '1px solid var(--ac-border)',
    marginTop: 8,
    position: 'sticky',
    bottom: 0,
    background: 'var(--ac-bg)'
  },
  btnPrimary: {
    padding: '8px 16px',
    minHeight: 36,
    background: 'var(--ac-accent)',
    color: 'var(--ac-accent-text)',
    border: 'none',
    borderRadius: 'var(--ac-radius)',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnSecondary: {
    padding: '8px 16px',
    minHeight: 36,
    background: 'var(--ac-surface-raised)',
    color: 'var(--ac-text)',
    border: '1px solid var(--ac-border)',
    borderRadius: 'var(--ac-radius)',
    cursor: 'pointer'
  },
  dirty: { fontSize: 'var(--ac-font-small)', color: 'var(--ac-text-muted)', marginLeft: 4 },
  savedPill: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 'var(--ac-font-small)',
    lineHeight: 1,
    color: 'var(--ac-success-fg)',
    background: 'var(--ac-success-bg)',
    border: '1px solid var(--ac-success-border)',
    borderRadius: 'var(--ac-radius-pill)',
    padding: '5px 12px',
    marginLeft: 4
  },

  // Getting-started callout shown while no optional source is enabled,
  // on the info family so it reads as guidance, not as a warning.
  infoCallout: {
    color: 'var(--ac-info-fg)',
    background: 'var(--ac-info-bg)',
    border: '1px solid var(--ac-info-border)',
    borderRadius: 'var(--ac-radius)',
    padding: '8px 12px',
    fontSize: 'var(--ac-font-small)',
    lineHeight: 1.45,
    margin: '0 0 10px'
  },

  // Non-fatal status-poll error banner.
  errorBanner: {
    color: 'var(--ac-danger-fg)',
    background: 'var(--ac-danger-bg)',
    border: '1px solid var(--ac-danger-border)',
    borderRadius: 'var(--ac-radius)',
    padding: '8px 12px',
    fontSize: 'var(--ac-font-body)',
    margin: '0 0 16px'
  }
} satisfies Record<string, CSSProperties>
