/**
 * Relative-time unit stepping for the ActiveCaptain detail renderer
 * (`active-captain/poi-detail-renderer.ts`), which phrases a delta like
 * "3 days ago" inside the rendered note HTML. The subtle "pick the coarsest
 * unit, then step up when rounding spills into the next unit" loop lives here
 * so the renderer's unit table stays declarative.
 *
 * The configuration panel does not use this: it renders ages through the
 * shared UI package's `RelativeAge`, which the plugin runtime cannot depend on
 * because that package is a development dependency bundled into the panel.
 */

/** A relative-time unit paired with its length in seconds. */
export type RelativeUnit = readonly [Intl.RelativeTimeFormatUnit, number]

/**
 * Format `deltaSeconds` (signed: negative is past, positive is future) using
 * the coarsest unit in `units` (ordered largest first) that the magnitude
 * reaches, then format it with `formatter`.
 *
 * Rounding within the chosen unit can spill into the next unit up: 3599 s is
 * under an hour but rounds to 60 minutes. When the rounded count reaches the
 * larger unit, the loop steps up so it reads "1 hour" rather than "60 minutes".
 * The last entry in `units` is the floor for a sub-unit delta.
 */
export function formatRelativeDelta (
  deltaSeconds: number,
  units: ReadonlyArray<RelativeUnit>,
  formatter: Intl.RelativeTimeFormat
): string {
  const absSeconds = Math.abs(deltaSeconds)

  let index = units.length - 1
  for (let i = 0; i < units.length; i++) {
    if (absSeconds >= units[i][1]) {
      index = i
      break
    }
  }

  while (index > 0 &&
    Math.round(absSeconds / units[index][1]) * units[index][1] >= units[index - 1][1]) {
    index -= 1
  }

  const [unit, secondsPerUnit] = units[index]
  return formatter.format(Math.round(deltaSeconds / secondsPerUnit), unit)
}
