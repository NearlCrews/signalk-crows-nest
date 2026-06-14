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
import { capitalizeFirst, presentString } from '../../shared/strings.js'

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
  return presentString(tags[key])
}

/**
 * The curated `seamark:<type>:*` family attributes, read once for both the
 * HTML family line and the structured family items so a new family attribute
 * is added in one place. Null when the element carries no `seamark:type`.
 */
export interface FamilyTags {
  category: string | undefined
  colour: string | undefined
  shape: string | undefined
}

/** Read the family-keyed attributes for the element's `seamark:type`. */
export function readFamilyTags (tags: Readonly<Record<string, string>>): FamilyTags | null {
  const type = tagValue(tags, 'seamark:type')?.toLowerCase()
  if (type === undefined) return null
  const prefix = `seamark:${type}:`
  return {
    category: tagValue(tags, `${prefix}category`),
    colour: tagValue(tags, `${prefix}colour`),
    shape: tagValue(tags, `${prefix}shape`)
  }
}

/**
 * The curated `seamark:light:*` tags, read once for both the HTML light line
 * and the structured light items so a new light tag is added in one place.
 */
export interface LightTags {
  character: string | undefined
  colour: string | undefined
  period: string | undefined
  range: string | undefined
  height: string | undefined
  exhibition: string | undefined
}

/** Read the light-family tags off an element. */
export function readLightTags (tags: Readonly<Record<string, string>>): LightTags {
  return {
    character: tagValue(tags, 'seamark:light:character'),
    colour: tagValue(tags, 'seamark:light:colour'),
    period: tagValue(tags, 'seamark:light:period'),
    range: tagValue(tags, 'seamark:light:range'),
    height: tagValue(tags, 'seamark:light:height'),
    exhibition: tagValue(tags, 'seamark:light:exhibition')
  }
}

/**
 * Compose a single descriptive line from the `seamark:light:*` family of
 * tags, or null when the element carries no light tags at all.
 */
function buildLightLine (tags: Readonly<Record<string, string>>): string | null {
  const light = readLightTags(tags)
  const parts: string[] = []
  if (light.character !== undefined) {
    parts.push(humanizeLightCharacter(light.character))
  }
  if (light.colour !== undefined) {
    parts.push(humanizeEnum(light.colour))
  }
  if (light.period !== undefined) {
    parts.push(`${light.period} s period`)
  }
  if (light.range !== undefined) {
    parts.push(`${light.range} NM range`)
  }
  if (light.height !== undefined) {
    parts.push(`${light.height} m high`)
  }
  if (light.exhibition !== undefined) {
    parts.push(`shown at ${humanizeEnum(light.exhibition)}`)
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
  const family = readFamilyTags(tags)
  if (family === null) {
    return null
  }
  const parts: string[] = []
  if (family.category !== undefined) {
    parts.push(humanizeEnum(family.category))
  }
  if (family.colour !== undefined) {
    parts.push(humanizeEnum(family.colour))
  }
  if (family.shape !== undefined) {
    parts.push(`${humanizeEnum(family.shape)} shape`)
  }
  if (parts.length === 0) {
    return null
  }
  const sentence = parts.join(', ')
  return capitalizeFirst(sentence)
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
