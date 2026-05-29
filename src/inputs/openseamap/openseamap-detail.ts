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
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'

/** Plain-English label for every `seamark:type` the plugin fetches. */
const TYPE_LABEL: Readonly<Record<string, string>> = {
  rock: 'Rock',
  wreck: 'Wreck',
  obstruction: 'Obstruction',
  harbour: 'Harbour',
  marina: 'Marina',
  lock_basin: 'Lock',
  bridge: 'Bridge',
  light_major: 'Major light',
  light_minor: 'Minor light',
  light_float: 'Light float',
  light_vessel: 'Light vessel',
  landmark: 'Landmark',
  beacon_lateral: 'Lateral beacon',
  beacon_cardinal: 'Cardinal beacon',
  beacon_isolated_danger: 'Isolated-danger beacon',
  beacon_safe_water: 'Safe-water beacon',
  beacon_special_purpose: 'Special-purpose beacon',
  buoy_lateral: 'Lateral buoy',
  buoy_cardinal: 'Cardinal buoy',
  buoy_isolated_danger: 'Isolated-danger buoy',
  buoy_safe_water: 'Safe-water buoy',
  buoy_special_purpose: 'Special-purpose buoy',
  anchorage: 'Anchorage',
  anchor_berth: 'Anchor berth',
  mooring: 'Mooring'
}

/**
 * IALA light character abbreviations, in plain English. A real value can
 * carry a parenthesised group count, e.g. `Fl(2)` or `Q(9)`, handled by the
 * caller after this base map is consulted.
 */
const LIGHT_CHARACTER: Readonly<Record<string, string>> = {
  F: 'fixed',
  Fl: 'flashing',
  LFl: 'long flashing',
  Q: 'quick flashing',
  IQ: 'interrupted quick',
  VQ: 'very quick',
  IVQ: 'interrupted very quick',
  UQ: 'ultra quick',
  IUQ: 'interrupted ultra quick',
  Iso: 'isophase',
  Oc: 'occulting',
  Mo: 'Morse',
  Al: 'alternating',
  FFl: 'fixed and flashing'
}

/** Pattern that splits a light character into its base and optional group. */
const LIGHT_CHARACTER_PATTERN = /^([A-Za-z]+)(\(.+\))?$/

/** Underscore separator in raw OSM enum values, replaced with a space for display. */
const UNDERSCORE_PATTERN = /_/g

/**
 * Read an OSM tag and trim whitespace. Returns undefined when the value is
 * absent or trims to the empty string. Older OSM edits occasionally surface
 * with leading or trailing whitespace; the lookup tables in this file and in
 * seamark-mapping.ts key on the trimmed form, so reading every tag through
 * this helper keeps the curation working on those records too.
 */
function tagValue (tags: Readonly<Record<string, string>>, key: string): string | undefined {
  const raw = tags[key]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Translate an IALA light-character value like `Fl(2)` into a phrase like
 * `flashing (2)`. An unmapped base abbreviation is left as-is so an exotic
 * character is at least recognisable; the group count rides along unchanged.
 */
export function humanizeLightCharacter (raw: string): string {
  const match = raw.match(LIGHT_CHARACTER_PATTERN)
  if (match === null) {
    return raw
  }
  const base = LIGHT_CHARACTER[match[1]] ?? match[1]
  return match[2] !== undefined ? `${base} ${match[2]}` : base
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
    parts.push(colour.replace(UNDERSCORE_PATTERN, ' '))
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
    parts.push(`shown at ${exhibition.replace(UNDERSCORE_PATTERN, ' ')}`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/** Header label for an element: the type label plus its name, if any. */
function buildHeader (tags: Readonly<Record<string, string>>): string {
  const type = tagValue(tags, 'seamark:type')?.toLowerCase()
  const leisure = tagValue(tags, 'leisure')?.toLowerCase()
  const label = (type !== undefined && TYPE_LABEL[type] !== undefined)
    ? TYPE_LABEL[type]
    : (leisure === 'marina' ? TYPE_LABEL.marina : 'OpenSeaMap feature')
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
  const type = tags['seamark:type']
  if (type === undefined) {
    return null
  }
  const prefix = `seamark:${type}:`
  const parts: string[] = []
  const category = tagValue(tags, `${prefix}category`)
  if (category !== undefined) {
    parts.push(category.replace(UNDERSCORE_PATTERN, ' '))
  }
  const colour = tagValue(tags, `${prefix}colour`)
  if (colour !== undefined) {
    parts.push(colour.replace(UNDERSCORE_PATTERN, ' '))
  }
  const shape = tagValue(tags, `${prefix}shape`)
  if (shape !== undefined) {
    parts.push(`${shape.replace(UNDERSCORE_PATTERN, ' ')} shape`)
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
