/**
 * Plain-English HTML renderer for a USCG Light List record.
 *
 * The wire format carries USCG-specific abbreviations and unit codes that
 * mean nothing on a chart popup; this module humanizes them. The IALA
 * light-character vocabulary is shared with the OpenSeaMap renderer: the
 * abbreviations are identical, so the table lives in
 * `src/shared/light-character.ts` as the single source of truth and a new
 * value belongs there rather than in a parallel table here.
 */

import type { LightListRecord } from './light-list-types.js'
import { humanizeLightCharacter } from '../../shared/light-character.js'
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'

/** Plain-English label for the single-letter USCG color codes. */
const COLOR: Readonly<Record<string, string>> = {
  W: 'white',
  R: 'red',
  G: 'green',
  Y: 'yellow',
  B: 'blue'
}

/** Strips a trailing seconds unit ("4s" to "4") from a light-character period token. */
const TRAILING_SECONDS_PATTERN = /s$/i

/**
 * Normalize a USCG nominal-range unit code to a short, friendly label.
 * Exported so the normalized-section builder humanizes ranges identically.
 */
export function rangeUnit (unit: string): string {
  if (unit === 'NAUT MI') return 'NM'
  if (unit === 'STAT MI') return 'mi'
  return unit
}

/**
 * Lowercase a USCG height unit ("FT") for inline use ("ft"). Exported so the
 * normalized-section builder humanizes heights identically.
 */
export function heightUnit (unit: string): string {
  return unit.toLowerCase()
}

/** Translate a single-letter color code to its English name. */
function humanizeColor (token: string): string {
  return COLOR[token] ?? token.toLowerCase()
}

/**
 * Translate a USCG-style light character string such as "Fl W 4s" into a
 * comma-separated, lowercase, English phrase such as "flashing, white, 4 s
 * period". Tokens are space-separated on the wire: the first carries the
 * IALA character abbreviation, the second the color, the third the period.
 * A shorter input simply produces a shorter phrase, and a blank one produces
 * no phrase at all, which is why callers go through
 * {@link lightCharacterPhrase} rather than this function directly.
 */
function humanizeLightChar (raw: string): string {
  const tokens = raw.trim().split(/\s+/)
  const parts: string[] = []
  if (tokens[0] !== '') {
    parts.push(humanizeLightCharacter(tokens[0]))
  }
  if (tokens.length > 1) {
    parts.push(humanizeColor(tokens[1]))
  }
  if (tokens.length > 2) {
    const period = tokens[2].replace(TRAILING_SECONDS_PATTERN, '')
    if (period.length > 0) {
      parts.push(`${period} s period`)
    }
  }
  return parts.join(', ')
}

/**
 * The humanized light character, or `undefined` when the aid has none to show.
 *
 * It takes the raw field including its absence, so "no character" is one
 * answer rather than a condition each caller tests before asking. That is the
 * same rule the Light line follows, made structural: an absent field and a
 * present one that humanizes to nothing are the same outcome to a renderer,
 * and a caller that has to spot the difference is a caller that can get it
 * wrong. A present field really can humanize to nothing, since a
 * whitespace-only wire value tokenizes to a single empty token, so every
 * branch of the humanizer is skipped and the join yields `''`.
 *
 * This is the light character's shared surface: the normalized-section builder
 * asks through it too, so the two renderings cannot disagree about whether an
 * aid has a character.
 */
export function lightCharacterPhrase (raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined
  }
  const phrase = humanizeLightChar(raw)
  return phrase === '' ? undefined : phrase
}

/**
 * Compose the descriptive Light line from the three light-related fields, or
 * null when none of them contributes anything (a daymark-only buoy, for
 * example).
 *
 * Emptiness is decided on what the line would actually render, not on which
 * fields are present. A separate presence guard is what once shipped a bare
 * `Light: .` onto the chart: the guard tested a field the body never read, so
 * a record carrying only that field passed the guard and then built no parts.
 * With the decision made here there is no second list of fields to drift from
 * this one.
 */
function lightLine (record: LightListRecord): string | null {
  const parts: string[] = []
  const character = lightCharacterPhrase(record.lightChar)
  if (character !== undefined) {
    parts.push(character)
  }
  if (record.nominalRange !== undefined) {
    parts.push(`${record.nominalRange.value} ${rangeUnit(record.nominalRange.unit)} range`)
  }
  if (record.focalPlane !== undefined) {
    parts.push(`${record.focalPlane.value} ${heightUnit(record.focalPlane.unit)} focal plane`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/** Compose the Structure line from the structure-type and -height fields. */
function structureLine (record: LightListRecord): string | null {
  if (record.structureType === undefined && record.structureHeight === undefined) {
    return null
  }
  const parts: string[] = []
  if (record.structureType !== undefined) {
    parts.push(record.structureType)
  }
  if (record.structureHeight !== undefined) {
    parts.push(`${record.structureHeight.value} ${heightUnit(record.structureHeight.unit)} tall`)
  }
  return parts.join(', ')
}

/** Compose the Daymark line from the daymark color and shape fields. */
function daymarkLine (record: LightListRecord): string | null {
  if (record.daymarkShape === undefined && record.daymarkColor === undefined) {
    return null
  }
  const parts: string[] = []
  if (record.daymarkColor !== undefined) {
    parts.push(record.daymarkColor)
  }
  if (record.daymarkShape !== undefined) {
    parts.push(record.daymarkShape)
  }
  return parts.join(' ')
}

/** Render the provenance line: Volume, District, last-updated date. */
function sourceLine (record: LightListRecord): string {
  const updated = record.modifiedDate !== undefined
    ? ` (last updated ${escapeHtml(record.modifiedDate.slice(0, 10))})`
    : ''
  return `USCG Light List, Volume ${escapeHtml(String(record.volume))}, District ${escapeHtml(record.district)}${updated}`
}

/** Render a USCG Light List record as a Freeboard-ready HTML description. */
export function renderLightListDetail (record: LightListRecord): string {
  const blocks: string[] = []
  const inactiveSuffix = record.inactive ? ' (inactive)' : ''
  blocks.push(`<h4>${escapeHtml(record.name)} (LLNR ${escapeHtml(String(record.llnr))})${inactiveSuffix}</h4>`)
  const light = lightLine(record)
  if (light !== null) {
    blocks.push(labeledParagraph('Light', light))
  }
  const structure = structureLine(record)
  if (structure !== null) {
    blocks.push(labeledParagraph('Structure', structure))
  }
  const daymark = daymarkLine(record)
  if (daymark !== null) {
    blocks.push(labeledParagraph('Daymark', daymark))
  }
  if (record.soundEmitterType !== undefined) {
    blocks.push(labeledParagraph('Sound signal', record.soundEmitterType))
  }
  if (record.racon !== undefined) {
    blocks.push(labeledParagraph('RACON', record.racon))
  }
  // Remarks deliberately omit the trailing period: the wire text often
  // already ends with its own punctuation, so this line stays bespoke. A
  // present remark is never blank: the parser stores it via presentString.
  if (record.remark !== undefined) {
    blocks.push(`<p><strong>Remarks:</strong> ${escapeHtml(record.remark)}</p>`)
  }
  blocks.push(`<p><strong>Source:</strong> ${sourceLine(record)}.</p>`)
  return blocks.join('')
}
