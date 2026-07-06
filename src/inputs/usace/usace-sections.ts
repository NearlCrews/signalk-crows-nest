/**
 * Normalized-section builder for one USACE lock or dam feature.
 *
 * Turns a raw USACE feature into the source-agnostic {@link NormalizedSection}[]
 * a structured chartplotter renders, carried on the note's
 * `properties.crowsNest.sections` alongside the HTML description. It mirrors the
 * same fields `usace-detail.ts` surfaces, through the same helpers, but emits
 * structured items rather than markup. Lengths are carried as `measure` items
 * in SI meters (converted from the wire's feet) so a structured client renders
 * them in the viewer's own units; every field is skipped when absent and an
 * empty section is dropped, matching the renderer's null-skipping.
 */

import type { UsaceFeature, UsaceLayerKey } from './usace-types.js'
import { structureName } from './usace-mapping.js'
import { meterMeasureItem, pushSection, textItem as makeTextItem } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'
import { metersFromFeet } from '../../shared/length.js'
import { finiteOrUndefined } from '../../shared/numbers.js'
import { presentString } from '../../shared/strings.js'

/** A measure item in SI meters converted from a wire feet value, or undefined when absent. */
function feetMeasure (label: string, rawFeet: unknown): NormalizedItem | undefined {
  const feet = finiteOrUndefined(rawFeet)
  return feet === undefined ? undefined : meterMeasureItem(label, metersFromFeet(feet))
}

/** A plain-text item, or undefined when the value is blank or absent. */
function textItem (label: string, rawValue: unknown): NormalizedItem | undefined {
  const value = presentString(rawValue)
  return value === undefined ? undefined : makeTextItem(label, value)
}

/** A whole-year text item, or undefined when the value is not a finite number. */
function yearItem (label: string, rawYear: unknown): NormalizedItem | undefined {
  const year = finiteOrUndefined(rawYear)
  return year === undefined ? undefined : makeTextItem(label, String(Math.trunc(year)))
}

/** Drop the undefined slots and append the section when it retains any item. */
function pushDefined (
  sections: NormalizedSection[],
  id: string,
  title: string,
  items: Array<NormalizedItem | undefined>
): void {
  pushSection(sections, id, title, items.filter((item): item is NormalizedItem => item !== undefined))
}

/** Build the normalized detail sections for a lock feature. */
function lockSections (properties: Record<string, unknown>): NormalizedSection[] {
  const sections: NormalizedSection[] = []
  const name = structureName('lock', properties)
  pushDefined(sections, 'chamber', 'Chamber', [
    name === undefined ? undefined : makeTextItem('Name', name),
    feetMeasure('Length', properties.LENGTH),
    feetMeasure('Width', properties.WIDTH),
    feetMeasure('Lift', properties.LIFT),
    textItem('Gate type', properties.GATETYPE)
  ])
  const river = presentString(properties.RIVER)
  const mile = finiteOrUndefined(properties.RIVERMI)
  pushDefined(sections, 'location', 'Location', [
    river === undefined ? undefined : makeTextItem('River', river),
    // The river mile is a location reference along the waterway, not a
    // convertible length, so it is a text item: a structured client that
    // auto-converts `measure` values would otherwise mangle it.
    mile === undefined ? undefined : makeTextItem('River mile', mile.toFixed(1)),
    textItem('State', properties.STATE)
  ])
  pushDefined(sections, 'source', 'Source', [
    yearItem('Opened', properties.YEAROPEN)
  ])
  return sections
}

/** Build the normalized detail sections for a dam feature. */
function damSections (properties: Record<string, unknown>): NormalizedSection[] {
  const sections: NormalizedSection[] = []
  const name = structureName('dam', properties)
  pushDefined(sections, 'structure', 'Structure', [
    name === undefined ? undefined : makeTextItem('Name', name),
    textItem('Dam type', properties.PRIMARY_DAM_TYPE),
    feetMeasure('Height', properties.DAM_HEIGHT),
    feetMeasure('Length', properties.DAM_LENGTH),
    textItem('Purpose', properties.PRIMARY_PURPOSE)
  ])
  pushDefined(sections, 'location', 'Location', [
    textItem('River', properties.RIVER_OR_STREAM),
    textItem('City', properties.CITY),
    textItem('State', properties.STATE)
  ])
  pushDefined(sections, 'safety', 'Safety', [
    textItem('Hazard potential', properties.HAZARD_POTENTIAL),
    textItem('Condition', properties.CONDITION_ASSESSMENT)
  ])
  pushDefined(sections, 'source', 'Source', [
    textItem('Owner', properties.PRIMARY_OWNER_TYPE),
    yearItem('Completed', properties.YEAR_COMPLETED)
  ])
  return sections
}

/** Build the normalized detail sections for one USACE feature. */
export function buildUsaceSections (
  layerKey: UsaceLayerKey,
  feature: UsaceFeature
): NormalizedSection[] {
  return layerKey === 'lock' ? lockSections(feature.properties) : damSections(feature.properties)
}
