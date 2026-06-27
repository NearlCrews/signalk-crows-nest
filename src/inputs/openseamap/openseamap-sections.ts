/**
 * Normalized-section builder for an OpenSeaMap (Overpass) element.
 *
 * Turns the curated OSM tags into the source-agnostic
 * {@link NormalizedSection}[] a structured chartplotter renders, carried on
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
import { tagValue, humanizeEnum, readFamilyTags, readLightTags } from './openseamap-detail.js'
import type { FamilyTags, LightTags } from './openseamap-detail.js'
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
function familyItems (family: FamilyTags | null): NormalizedItem[] {
  if (family === null) return []
  const items: NormalizedItem[] = []
  if (family.category !== undefined) {
    items.push({ label: 'Category', value: humanizeEnum(family.category), kind: 'text' })
  }
  if (family.colour !== undefined) {
    items.push({ label: 'Colour', value: humanizeEnum(family.colour), kind: 'text' })
  }
  if (family.shape !== undefined) {
    items.push({ label: 'Shape', value: humanizeEnum(family.shape), kind: 'text' })
  }
  return items
}

/**
 * Items for the `seamark:light:*` family. Mirrors `buildLightLine`: the
 * character is humanized, the colour and exhibition have their underscores
 * normalized, and the period (s), range (NM), and height (m) are measures.
 */
function lightItems (light: LightTags): NormalizedItem[] {
  const items: NormalizedItem[] = []
  if (light.character !== undefined) {
    items.push({ label: 'Character', value: humanizeLightCharacter(light.character), kind: 'text' })
  }
  if (light.colour !== undefined) {
    items.push({ label: 'Colour', value: humanizeEnum(light.colour), kind: 'text' })
  }
  pushMeasure(items, 'Period', light.period, 's')
  pushMeasure(items, 'Range', light.range, 'NM')
  pushMeasure(items, 'Height', light.height, 'm')
  if (light.exhibition !== undefined) {
    items.push({ label: 'Exhibition', value: humanizeEnum(light.exhibition), kind: 'text' })
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
export function buildOpenSeaMapSections (
  element: OverpassElement,
  family: FamilyTags | null = readFamilyTags(element.tags),
  light: LightTags = readLightTags(element.tags)
): NormalizedSection[] {
  const { tags } = element
  const sections: NormalizedSection[] = []
  pushSection(sections, 'feature', 'Feature', familyItems(family))
  pushSection(sections, 'light', 'Light', lightItems(light))
  pushSection(sections, 'notes', 'Notes', noteItems(tags))
  return sections
}
