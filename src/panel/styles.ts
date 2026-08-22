/** Domain-specific inline styles for the federated configuration panel. */

import type { CSSProperties } from 'react'

/**
 * Aliases retained by Crow's Nest styles that now read shared UI tokens.
 * Keeping them on PanelRoot's inline style avoids a second runtime stylesheet
 * and the fragile host-nonce scan that stylesheet required.
 */
export const PANEL_STYLE: CSSProperties & Record<`--ac-${string}`, string> = {
  '--ac-radius': 'var(--snui-radius-md)',
  '--ac-radius-sm': 'var(--snui-radius-sm)',
  '--ac-font-body': 'var(--snui-font-size)',
  '--ac-font-small': '0.8125rem',
  '--ac-font-title': '1rem',
  '--ac-space-1': 'var(--snui-space-2)',
  '--ac-space-2': 'var(--snui-space-3)',
  '--ac-space-3': 'var(--snui-space-4)',
  '--ac-surface': 'var(--snui-color-surface)',
  '--ac-surface-muted': 'var(--snui-color-interactive-hover)',
  '--ac-border': 'var(--snui-color-border)',
  '--ac-text': 'var(--snui-color-text)',
  '--ac-text-muted': 'var(--snui-color-text-muted)',
  '--ac-text-faint': 'var(--snui-color-text-muted)',
  '--ac-accent': 'var(--snui-color-accent-fill)',
  '--ac-ok': 'var(--snui-color-success)',
  '--ac-off': 'var(--snui-color-text-muted)',
  '--ac-danger-bg': 'color-mix(in srgb, var(--snui-color-danger) 12%, var(--snui-color-surface))',
  '--ac-danger-fg': 'var(--snui-color-danger)',
  '--ac-danger-border': 'color-mix(in srgb, var(--snui-color-danger) 60%, var(--snui-color-border))'
}

/**
 * Fixed-width face for a field holding a URL or another identifier, where a
 * typo in a host name is easier to spot in a mono face. Shared by the Overpass
 * endpoint field and the fallback-endpoints list so the two cannot drift.
 */
const MONO_TEXT: CSSProperties = { fontFamily: 'var(--snui-font-family-mono)' }

/** Shared face of the hint paragraph; the two variants differ only in margin. */
const HINT_BASE: CSSProperties = {
  fontSize: 'var(--ac-font-small)',
  color: 'var(--ac-text-muted)',
  lineHeight: 1.45
}

/**
 * The named style tokens consumed by panel components. Declared with a
 * `satisfies` clause so each value is checked as a CSSProperties literal while
 * the inferred type of `S` keeps its specific keys: indexing `S.unknownKey`
 * remains a TypeScript error, which a `Record<string, CSSProperties>`
 * annotation would have silently allowed.
 *
 * Touch sizing reads `--snui-control-min-height`, the shared UI package's
 * public target-size token. That token is a contract, not a theme decision:
 * the package guarantees 40 CSS pixels, rising to 44 wherever the device
 * reports any coarse pointer. Inline styles carry no media query, so a
 * literal here could not make that coarse-pointer step at all, which is the
 * step a panel operated at the helm actually depends on. The checkbox keeps
 * its 22px painted box and gets the full target from the wrapper around it.
 */
export const S = {
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
  // Title row wrapper so the freshness note sits on the same line as the title.
  statusTitleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8
  },
  // The freshness note in the title row: muted, small, right-aligned.
  statusCheckedAt: {
    fontSize: 'var(--ac-font-small)',
    fontWeight: 400,
    color: 'var(--ac-text-faint)',
    marginLeft: 'auto'
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
    gap: 'var(--ac-space-1)',
    fontSize: 'var(--ac-font-small)',
    color: 'var(--ac-danger-fg)',
    background: 'var(--ac-danger-bg)',
    border: '1px solid var(--ac-danger-border)',
    borderRadius: 'var(--ac-radius-sm)',
    padding: 'var(--snui-space-1) var(--ac-space-1)'
  },
  statusErrorTime: { color: 'var(--ac-text-faint)', flexShrink: 0 },
  // A recent-error entry rendered as a jump-to-card button: inherits the
  // error-item palette, drops the button chrome, and keeps the row clickable
  // without reading as a primary control.
  statusErrorJump: {
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    textDecoration: 'underline'
  },

  /**
   * Default hint paragraph style. Used by callers that supply their own
   * outer container spacing (toggle hints inside ToggleFieldset, the
   * rationale paragraph in MergeWithActiveCaptain, the empty-state hints
   * in fieldset bodies). Defaults to `margin: 0` so a hint nested inside
   * a labeled group inherits the group's vertical rhythm and does NOT
   * grow its own bottom margin.
   */
  hint: {
    ...HINT_BASE,
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
    ...HINT_BASE,
    margin: '0 0 var(--ac-space-2)'
  },

  // Grouped-options sections: a header with a select-all control, and one
  // fieldset per group. Used by both the ActiveCaptain POI-type selector and
  // the OpenSeaMap seamark-group checklist.
  groupsSection: { marginBottom: 'var(--ac-space-3)' },
  checkboxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 6
  },
  // 22px boxes with the accent check fill: accentColor keeps the checked
  // fill on-palette in every theme. The painted box stays at 22px; where the
  // box needs a helm-sized tap target, `checkboxTarget` supplies it.
  checkbox: {
    width: 22,
    height: 22,
    flexShrink: 0,
    cursor: 'pointer',
    accentColor: 'var(--ac-accent)'
  },
  // Tap target around a bare checkbox. A native checkbox is only as clickable
  // as it is painted, so the 22px box alone lands under both the shared UI
  // target-size contract and the WCAG minimum. Wrapping it in a label of at
  // least one control height makes the whole square activate the box.
  // A single-line field holding a URL or another identifier.
  monoInput: MONO_TEXT,
  // The fallback-endpoints list: the same mono face over several lines.
  monoTextarea: { ...MONO_TEXT, minHeight: 56 },
  checkboxTarget: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 'var(--snui-control-min-height)',
    minHeight: 'var(--snui-control-min-height)',
    flexShrink: 0,
    cursor: 'pointer'
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
    padding: '10px 14px',
    minWidth: 0
  },
  sourceCardToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    minHeight: 'var(--snui-control-min-height)',
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
    flexShrink: 1,
    minWidth: 0,
    overflowWrap: 'anywhere'
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
   * being hidden from layout and paint. Focus restoration is handled by
   * the source card's collapse hook.
   */
  collapsedBody: {
    display: 'none'
  }
} satisfies Record<string, CSSProperties>
