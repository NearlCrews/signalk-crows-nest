/**
 * Glue between the plugin's per-flag boolean configuration and the shared
 * `CheckboxGroup`, which reports its selection as an array of option values.
 *
 * The configuration reducer has one action per import layer (for example
 * `setNoaaEncIncludeWrecks`), so a card cannot hand the group one setter. It
 * instead describes each layer as a `ValueToggle`, and these helpers translate
 * in both directions: the checked toggles become the group's `value`, and a
 * new selection fires `onChange` only for the toggles whose membership
 * actually changed, so an unchanged layer dispatches nothing.
 *
 * Pure and React-free so the node:test suite covers the translation.
 */

/** One boolean layer, exposed to a `CheckboxGroup` as an option. */
export interface ValueToggle<Value extends string = string> {
  /** The option value; also the React key and the id in the reported selection. */
  value: Value
  /** The visible option label. */
  label: string
  /** Whether the layer is currently on. */
  checked: boolean
  /** Called with the new state when the selection flips this layer. */
  onChange: (checked: boolean) => void
}

/** The values of the toggles that are on, in toggle order. */
export function selectedValues<Value extends string> (
  toggles: ReadonlyArray<ValueToggle<Value>>
): Value[] {
  return toggles.filter((toggle) => toggle.checked).map((toggle) => toggle.value)
}

/**
 * Apply a selection reported by the group: every toggle whose membership in
 * `values` differs from its current state receives `onChange`, and nothing
 * else fires.
 */
export function applySelectedValues<Value extends string> (
  toggles: ReadonlyArray<ValueToggle<Value>>,
  values: ReadonlyArray<Value>
): void {
  const selected = new Set(values)
  for (const toggle of toggles) {
    const checked = selected.has(toggle.value)
    if (checked !== toggle.checked) toggle.onChange(checked)
  }
}
