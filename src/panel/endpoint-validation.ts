/**
 * Validation for the OpenSeaMap connection fields, shared by the two fields
 * that render it and by the panel root that blocks Save on it.
 *
 * The plugin coerces these values rather than rejecting them: a primary
 * endpoint that is not a usable http or https URL is replaced by the FOSSGIS
 * default, and an unusable fallback line is dropped, in the input module and
 * in this panel's own normalizeConfig alike. So a typo is saved, ignored, and
 * gone by the next mount, with OpenSeaMap quietly querying an endpoint other
 * than the one that was on screen. Reporting it before the save is what closes
 * that gap; the coercion stays where it is, because a hand-edited config file
 * still has to load.
 *
 * The rule is not restated here. Both checks call `usableEndpoint`, the same
 * predicate `resolvePrimaryEndpoint` and `normalizeFallbackEndpoints` are
 * built on, so the panel and the plugin cannot drift on what counts as a
 * usable endpoint.
 */

import { usableEndpoint } from '../shared/overpass-endpoints.js'
import { joinWords } from '../shared/strings.js'
import type { PluginConfig } from '../shared/types.js'

/** What a usable endpoint looks like, named once for every message below. */
const ENDPOINT_RULE = 'a full http or https URL with no embedded credentials'

/**
 * The two field labels. They live here rather than in the fields because the
 * save bar names them from far away, so a rename that touched only the field
 * would leave the bar pointing at a label no longer on screen. Each field
 * renders its own from here.
 */
export const PRIMARY_LABEL = 'Overpass API endpoint URL'

/** Companion to {@link PRIMARY_LABEL}. */
export const FALLBACK_LABEL = 'Fallback endpoints'

/**
 * Why the primary endpoint cannot be used, or undefined when it can.
 *
 * A blank field is not an error: the plugin documents it as the way to take
 * the default, and an empty box claims to be no endpoint at all, so it cannot
 * mislead the way a wrong one does.
 */
export function primaryEndpointError (value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  if (trimmed === '' || usableEndpoint(trimmed) !== undefined) return undefined
  return `Enter ${ENDPOINT_RULE}, or clear the field to use the default.`
}

/** The 1-based positions of the fallback lines the plugin would drop. */
function unusableFallbackLines (lines: readonly string[]): number[] {
  const positions: number[] = []
  lines.forEach((line, index) => {
    if (line.trim() === '') return
    if (usableEndpoint(line) === undefined) positions.push(index + 1)
  })
  return positions
}

/**
 * Why the fallback list cannot be used, or undefined when it can. Blank lines
 * are ignored so the list stays editable mid-edit, and a repeated mirror is
 * not reported: the plugin collapses duplicates, which costs the operator
 * nothing.
 */
export function fallbackEndpointsError (lines: readonly string[] | undefined): string | undefined {
  const positions = unusableFallbackLines(lines ?? [])
  if (positions.length === 0) return undefined
  const subject = positions.length === 1
    ? `Line ${positions[0]} is not`
    : `Lines ${joinWords(positions.map(String))} are not`
  return `${subject} ${ENDPOINT_RULE}.`
}

/**
 * The one message the save bar shows while any endpoint field is unusable,
 * naming its field because the bar sits far from both. Undefined lets the
 * save bar report the configuration as usual.
 */
export function endpointInvalidMessage (state: PluginConfig): string | undefined {
  const problems: string[] = []
  if (primaryEndpointError(state.openSeaMapEndpoint) !== undefined) {
    problems.push(PRIMARY_LABEL)
  }
  if (fallbackEndpointsError(state.openSeaMapFallbackEndpoints) !== undefined) {
    problems.push(FALLBACK_LABEL)
  }
  if (problems.length === 0) return undefined
  const fields = joinWords(problems)
  return `${fields} ${problems.length === 1 ? 'needs' : 'need'} ${ENDPOINT_RULE}.`
}
