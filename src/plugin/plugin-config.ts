/**
 * Plugin config-schema assembly.
 *
 * The plugin config schema is no longer one literal: each input and output
 * module contributes a `properties` fragment, and this module merges them into
 * the single schema object the SignalK admin UI renders. A duplicated property
 * key across modules is a wiring bug and throws rather than silently shadowing.
 */

/** The assembled JSON Schema for the plugin configuration. */
export interface PluginSchema {
  title: string
  description: string
  type: 'object'
  required: string[]
  properties: Record<string, unknown>
}

/** The one always-required config property. */
const REQUIRED_PROPERTIES = ['cachingDurationMinutes']

/**
 * Merge per-module `properties` fragments into one plugin schema.
 *
 * @param title       Plugin title, shown by the admin UI.
 * @param description Plugin description, shown by the admin UI.
 * @param fragments   Per-module `properties` fragments, in registration order.
 */
export function assemblePluginSchema (
  title: string,
  description: string,
  fragments: Array<Record<string, unknown>>
): PluginSchema {
  const properties: Record<string, unknown> = {}
  for (const fragment of fragments) {
    for (const [key, value] of Object.entries(fragment)) {
      if (key in properties) {
        throw new Error(`Duplicate config property "${key}" across modules`)
      }
      properties[key] = value
    }
  }
  // Every required key must be backed by a merged property; otherwise the
  // admin UI would render a required slot with no schema. A missing backing
  // property is a wiring bug (the module that owned it was renamed or dropped)
  // and is treated the same as a duplicate key: throw at assembly time.
  for (const key of REQUIRED_PROPERTIES) {
    if (!(key in properties)) {
      throw new Error(
        `Required config property "${key}" is not declared by any module`
      )
    }
  }
  return {
    title,
    description,
    type: 'object',
    required: [...REQUIRED_PROPERTIES],
    properties
  }
}
