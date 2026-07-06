/**
 * Plain-English HTML renderer for one USACE lock or dam feature.
 *
 * Translates the raw ArcGIS properties into a friendly popup. Lengths (chamber
 * dimensions and lift for a lock, height and length for a dam) arrive IN FEET
 * and are stored and rendered in SI meters, matching the meters the NOAA ENC
 * renderer emits; the normalized sections carry the same values as `measure`
 * items so a structured client can re-render them in the viewer's own units.
 * Opaque single-character lock codes (`STATUS`, `OPER1`, `OWNER1`) are skipped
 * rather than surfaced as a bare digit. Absent, null, and blank fields are
 * dropped, never written as the word "null".
 */

import type { UsaceLayerKey } from './usace-types.js'
import { LAYER_LABEL, structureName } from './usace-mapping.js'
import { escapeHtml, labeledMeters, labeledParagraph } from '../../shared/html-escape.js'
import { formatMeters } from '../../shared/format-meters.js'
import { metersFromFeet } from '../../shared/length.js'
import { finiteOrUndefined } from '../../shared/numbers.js'
import { presentString } from '../../shared/strings.js'

/** Format a feet value as an SI-meter string, or undefined when not a finite number. */
function metersFromFeetLabel (rawFeet: unknown): string | undefined {
  const feet = finiteOrUndefined(rawFeet)
  return feet === undefined ? undefined : formatMeters(metersFromFeet(feet))
}

/** A `<p><strong>Label:</strong> X.X m.</p>` line, or undefined when the value is absent. */
function metersParagraph (label: string, rawFeet: unknown): string | undefined {
  const feet = finiteOrUndefined(rawFeet)
  return feet === undefined ? undefined : labeledMeters(label, metersFromFeet(feet))
}

/** A labeled text line, or undefined when the value is blank or absent. */
function textParagraph (label: string, rawValue: unknown): string | undefined {
  const value = presentString(rawValue)
  return value === undefined ? undefined : labeledParagraph(label, value)
}

/** A labeled whole-year line, or undefined when the value is not a finite number. */
function yearParagraph (label: string, rawYear: unknown): string | undefined {
  const year = finiteOrUndefined(rawYear)
  return year === undefined ? undefined : labeledParagraph(label, String(Math.trunc(year)))
}

/** The `<h4>` header for a feature: its name, or the layer label when unnamed. */
function header (layerKey: UsaceLayerKey, properties: Record<string, unknown>): string {
  const name = structureName(layerKey, properties) ?? LAYER_LABEL[layerKey]
  return `<h4>${escapeHtml(name)}</h4>`
}

/** The "River: Name (mile M)." line, present when the waterway name is known. */
function riverParagraph (rawRiver: unknown, rawMile: unknown): string | undefined {
  const river = presentString(rawRiver)
  if (river === undefined) return undefined
  const mile = finiteOrUndefined(rawMile)
  const tail = mile === undefined ? '' : ` (mile ${mile.toFixed(1)})`
  return `<p><strong>River:</strong> ${escapeHtml(river)}${escapeHtml(tail)}.</p>`
}

/** Render the popup HTML for a lock. */
function renderLock (properties: Record<string, unknown>): string {
  const lengthM = metersFromFeetLabel(properties.LENGTH)
  const widthM = metersFromFeetLabel(properties.WIDTH)
  let chamber: string | undefined
  if (lengthM !== undefined && widthM !== undefined) {
    chamber = `<p><strong>Chamber:</strong> ${lengthM} m long and ${widthM} m wide.</p>`
  } else if (lengthM !== undefined) {
    chamber = `<p><strong>Chamber length:</strong> ${lengthM} m.</p>`
  } else if (widthM !== undefined) {
    chamber = `<p><strong>Chamber width:</strong> ${widthM} m.</p>`
  }
  return [
    header('lock', properties),
    riverParagraph(properties.RIVER, properties.RIVERMI),
    chamber,
    metersParagraph('Lift', properties.LIFT),
    textParagraph('Gate type', properties.GATETYPE),
    yearParagraph('Opened', properties.YEAROPEN),
    textParagraph('State', properties.STATE)
  ].filter((block): block is string => block !== undefined).join('')
}

/** The "Location: City, ST." line, present when at least the state is known. */
function locationParagraph (rawCity: unknown, rawState: unknown): string | undefined {
  const city = presentString(rawCity)
  const state = presentString(rawState)
  const place = [city, state].filter((part): part is string => part !== undefined).join(', ')
  return place.length === 0 ? undefined : `<p><strong>Location:</strong> ${escapeHtml(place)}.</p>`
}

/** Render the popup HTML for a dam. */
function renderDam (properties: Record<string, unknown>): string {
  return [
    header('dam', properties),
    riverParagraph(properties.RIVER_OR_STREAM, undefined),
    locationParagraph(properties.CITY, properties.STATE),
    textParagraph('Purpose', properties.PRIMARY_PURPOSE),
    textParagraph('Dam type', properties.PRIMARY_DAM_TYPE),
    metersParagraph('Height', properties.DAM_HEIGHT),
    metersParagraph('Length', properties.DAM_LENGTH),
    yearParagraph('Completed', properties.YEAR_COMPLETED),
    textParagraph('Hazard potential', properties.HAZARD_POTENTIAL),
    textParagraph('Condition', properties.CONDITION_ASSESSMENT),
    textParagraph('Owner', properties.PRIMARY_OWNER_TYPE)
  ].filter((block): block is string => block !== undefined).join('')
}

/** Render the popup HTML for one USACE feature. */
export function renderUsaceDetail (
  layerKey: UsaceLayerKey,
  properties: Record<string, unknown>
): string {
  return layerKey === 'lock' ? renderLock(properties) : renderDam(properties)
}
