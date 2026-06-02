/**
 * Normalized-section builder for an OpenSeaMap (Overpass) element.
 *
 * Turns the curated OSM tags into the source-agnostic
 * {@link NormalizedSection}[] a structured chart plotter renders, carried on
 * the note's `properties.crowsNest.sections` alongside the HTML description.
 *
 * It mirrors the content of `openseamap-detail.ts`'s HTML renderer (the same
 * curated tags, read through the same {@link tagValue} and {@link humanizeEnum}
 * helpers, and the same {@link humanizeLightCharacter} translation) but emits
 * structured items rather than the joined prose sentences. The HTML folds the
 * family and light tags into one or two lines; here each tag is its own item.
 * An empty section is dropped, so a bare rock with no curated tags shows no
 * empty headings, matching the renderer's "No additional detail available."
 */

import type { OverpassElement } from './overpass-client.js'
import { tagValue, humanizeEnum } from './openseamap-detail.js'
import { humanizeLightCharacter } from '../../shared/light-character.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/**
 * Push a `measure` item with the given unit when the tag parses to a finite
 * number, mirroring the HTML's `${value} <unit>` line. A present-but-non-numeric
 * value (an unusual free-text entry) falls back to a plain `text` item so the
 * value the HTML would still surface is not silently dropped.
 */
function pushMeasure (
  items: NormalizedItem[],
  label: string,
  raw: string | undefined,
  unit: string
): void {
  if (raw === undefined) return
  // OSM serves every tag as a string, and `raw` is already trimmed-non-empty
  // by tagValue. A clean numeric value becomes a `measure` with its unit; a
  // non-numeric entry (an unusual free-text value) stays a `text` item so it
  // is not silently dropped.
  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    items.push({ label, value: numeric, kind: 'measure', unit })
  } else {
    items.push({ label, value: raw, kind: 'text' })
  }
}

/**
 * Items for the family line (`seamark:<type>:category/colour/shape`). Mirrors
 * `buildFamilyLine`: the family key follows from the `seamark:type` value.
 */
function familyItems (tags: Readonly<Record<string, string>>): NormalizedItem[] {
  const type = tagValue(tags, 'seamark:type')?.toLowerCase()
  if (type === undefined) return []
  const prefix = `seamark:${type}:`
  const items: NormalizedItem[] = []
  const category = tagValue(tags, `${prefix}category`)
  if (category !== undefined) {
    items.push({ label: 'Category', value: humanizeEnum(category), kind: 'text' })
  }
  const colour = tagValue(tags, `${prefix}colour`)
  if (colour !== undefined) {
    items.push({ label: 'Colour', value: humanizeEnum(colour), kind: 'text' })
  }
  const shape = tagValue(tags, `${prefix}shape`)
  if (shape !== undefined) {
    items.push({ label: 'Shape', value: humanizeEnum(shape), kind: 'text' })
  }
  return items
}

/**
 * Items for the `seamark:light:*` family. Mirrors `buildLightLine`: the
 * character is humanized, the colour and exhibition have their underscores
 * normalized, and the period (s), range (NM), and height (m) are measures.
 */
function lightItems (tags: Readonly<Record<string, string>>): NormalizedItem[] {
  const items: NormalizedItem[] = []
  const character = tagValue(tags, 'seamark:light:character')
  if (character !== undefined) {
    items.push({ label: 'Character', value: humanizeLightCharacter(character), kind: 'text' })
  }
  const colour = tagValue(tags, 'seamark:light:colour')
  if (colour !== undefined) {
    items.push({ label: 'Colour', value: humanizeEnum(colour), kind: 'text' })
  }
  pushMeasure(items, 'Period', tagValue(tags, 'seamark:light:period'), 's')
  pushMeasure(items, 'Range', tagValue(tags, 'seamark:light:range'), 'NM')
  pushMeasure(items, 'Height', tagValue(tags, 'seamark:light:height'), 'm')
  const exhibition = tagValue(tags, 'seamark:light:exhibition')
  if (exhibition !== undefined) {
    items.push({ label: 'Exhibition', value: humanizeEnum(exhibition), kind: 'text' })
  }
  return items
}

/**
 * Items for the free-prose tags (`seamark:information`, `seamark:notice`),
 * each a `note`. Mirrors the Information and Notice paragraphs.
 */
function noteItems (tags: Readonly<Record<string, string>>): NormalizedItem[] {
  const items: NormalizedItem[] = []
  const information = tagValue(tags, 'seamark:information')
  if (information !== undefined) {
    items.push({ label: 'Information', value: information, kind: 'note' })
  }
  const notice = tagValue(tags, 'seamark:notice')
  if (notice !== undefined) {
    items.push({ label: 'Notice', value: notice, kind: 'note' })
  }
  return items
}

/** Build the normalized detail sections for an OpenSeaMap element. */
export function buildOpenSeaMapSections (element: OverpassElement): NormalizedSection[] {
  const { tags } = element
  const sections: NormalizedSection[] = []
  pushSection(sections, 'feature', 'Feature', familyItems(tags))
  pushSection(sections, 'light', 'Light', lightItems(tags))
  pushSection(sections, 'notes', 'Notes', noteItems(tags))
  return sections
}
