/**
 * User-friendly detail renderer for an OpenSeaMap element.
 *
 * The Overpass response carries every OSM tag verbatim, including technical
 * keys (`man_made`, the raw `seamark:type` enum) and family-specific keys
 * (`seamark:buoy_lateral:colour`, `seamark:light:character`, etc.) that mean
 * nothing on a chart popup. This module curates the tags that matter to a
 * mariner, labels them in plain English, translates the IALA light character
 * abbreviations, and ignores the rest. The attribution credit rides on
 * `properties.attribution` of the produced note, not inline in this HTML.
 */

import type { OverpassElement } from './overpass-client.js'
import { seamarkLabel } from './seamark-mapping.js'
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'
import { humanizeLightCharacter } from '../../shared/light-character.js'

/** Underscore separator in raw OSM enum values, replaced with a space for display. */
const UNDERSCORE_PATTERN = /_/g

/**
 * Display form of a raw OSM enum value: underscores become spaces, so
 * `port_hand` reads `port hand`. Exported so the normalized-section builder
 * humanizes a category, colour, shape, or exhibition value exactly as this
 * HTML renderer does and the two cannot drift.
 */
export function humanizeEnum (value: string): string {
  return value.replace(UNDERSCORE_PATTERN, ' ')
}

/**
 * Read an OSM tag and trim whitespace. Returns undefined when the value is
 * absent or trims to the empty string. Older OSM edits occasionally surface
 * with leading or trailing whitespace; the lookup tables in this file and in
 * seamark-mapping.ts key on the trimmed form, so reading every tag through
 * this helper keeps the curation working on those records too. Exported so the
 * source's name resolver shares the same trim-and-reject-empty behaviour.
 */
export function tagValue (tags: Readonly<Record<string, string>>, key: string): string | undefined {
  const raw = tags[key]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Compose a single descriptive line from the `seamark:light:*` family of
 * tags, or null when the element carries no light tags at all.
 */
function buildLightLine (tags: Readonly<Record<string, string>>): string | null {
  const parts: string[] = []
  const character = tagValue(tags, 'seamark:light:character')
  if (character !== undefined) {
    parts.push(humanizeLightCharacter(character))
  }
  const colour = tagValue(tags, 'seamark:light:colour')
  if (colour !== undefined) {
    parts.push(humanizeEnum(colour))
  }
  const period = tagValue(tags, 'seamark:light:period')
  if (period !== undefined) {
    parts.push(`${period} s period`)
  }
  const range = tagValue(tags, 'seamark:light:range')
  if (range !== undefined) {
    parts.push(`${range} NM range`)
  }
  const height = tagValue(tags, 'seamark:light:height')
  if (height !== undefined) {
    parts.push(`${height} m high`)
  }
  const exhibition = tagValue(tags, 'seamark:light:exhibition')
  if (exhibition !== undefined) {
    parts.push(`shown at ${humanizeEnum(exhibition)}`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/** Header label for an element: the type label plus its name, if any. */
function buildHeader (tags: Readonly<Record<string, string>>): string {
  const type = tagValue(tags, 'seamark:type')?.toLowerCase()
  const leisure = tagValue(tags, 'leisure')?.toLowerCase()
  const label = (type !== undefined ? seamarkLabel(type) : undefined) ??
    (leisure === 'marina' ? seamarkLabel('marina') : undefined) ??
    'OpenSeaMap feature'
  const name = tagValue(tags, 'name') ?? tagValue(tags, 'seamark:name')
  return name !== undefined
    ? `${escapeHtml(label)}: ${escapeHtml(name)}`
    : escapeHtml(label)
}

/**
 * Pull the category, shape, and colour of a seamark family (`buoy_lateral`,
 * `beacon_cardinal`, etc.) into a single descriptive line. The family key is
 * determined by the `seamark:type` value, so a single template fits every
 * family that follows the standard tagging convention.
 */
function buildFamilyLine (tags: Readonly<Record<string, string>>): string | null {
  const type = tagValue(tags, 'seamark:type')?.toLowerCase()
  if (type === undefined) {
    return null
  }
  const prefix = `seamark:${type}:`
  const parts: string[] = []
  const category = tagValue(tags, `${prefix}category`)
  if (category !== undefined) {
    parts.push(humanizeEnum(category))
  }
  const colour = tagValue(tags, `${prefix}colour`)
  if (colour !== undefined) {
    parts.push(humanizeEnum(colour))
  }
  const shape = tagValue(tags, `${prefix}shape`)
  if (shape !== undefined) {
    parts.push(`${humanizeEnum(shape)} shape`)
  }
  if (parts.length === 0) {
    return null
  }
  const sentence = parts.join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/**
 * Render a friendly HTML description for an OpenSeaMap element. Curates the
 * seamark tags that matter to a mariner; the technical OSM enums and the
 * verbose family-keyed tags are folded into one or two short sentences.
 */
export function renderOpenSeaMapDetail (element: OverpassElement): string {
  const tags = element.tags
  const blocks: string[] = []

  blocks.push(`<h4>${buildHeader(tags)}</h4>`)

  const familyLine = buildFamilyLine(tags)
  if (familyLine !== null) {
    blocks.push(`<p>${escapeHtml(familyLine)}.</p>`)
  }

  const lightLine = buildLightLine(tags)
  if (lightLine !== null) {
    blocks.push(labeledParagraph('Light', lightLine))
  }

  const information = tagValue(tags, 'seamark:information')
  if (information !== undefined) {
    blocks.push(labeledParagraph('Information', information))
  }
  const notice = tagValue(tags, 'seamark:notice')
  if (notice !== undefined) {
    blocks.push(labeledParagraph('Notice', notice))
  }

  // If none of the curated tags supplied any content, surface a brief note
  // rather than dumping the raw OSM enum table.
  if (blocks.length === 1) {
    blocks.push('<p>No additional detail available.</p>')
  }

  return blocks.join('')
}
