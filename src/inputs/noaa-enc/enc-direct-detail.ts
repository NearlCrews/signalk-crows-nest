/**
 * Plain-English HTML renderer for one NOAA ENC Direct feature.
 *
 * Translates the raw S-57 properties the ArcGIS service emits (mixed shapes:
 * pre-decoded category strings, numeric water-level codes, single-digit
 * string codes for sounding quality and technique, frequent JSON `null`s)
 * into a friendly popup. Every renderer call ends with the NOAA navigation
 * disclaimer per the data-licensing terms.
 *
 * Field shapes verified live against the wreck (33), obstruction (30), and
 * underwater-rock (31) layers at the coastal scale band; see s57-mapping.ts
 * for the wire-shape notes the helpers in this file lean on.
 */

import {
  WATLEV,
  QUASOU,
  TECSOU,
  formatSordatDisplay,
  humanizeCategory,
  lookupCode
} from './s57-mapping.js'
import type { EncLayerKey } from './enc-direct-types.js'
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'
import { toFiniteNumber } from '../../shared/numbers.js'

/** Layer-derived fallback header label when OBJNAM is null or absent. */
const LAYER_LABEL: Readonly<Record<EncLayerKey, string>> = {
  wreck: 'Wreck',
  obstruction: 'Obstruction',
  rock: 'Rock'
}

/** NOAA's standard disclaimer for ENC data published through Coast Survey. */
const DISCLAIMER = 'NOAA ENC data is not intended for primary navigation.'

/**
 * Resolve the category label (CATWRK for a wreck, CATOBS for an obstruction).
 * Rocks have no category field. Returns undefined when the field is null,
 * blank, or absent.
 */
function categoryLabel (
  layerKey: EncLayerKey,
  properties: Record<string, unknown>
): string | undefined {
  if (layerKey === 'wreck') {
    return humanizeCategory(properties.CATWRK)
  }
  if (layerKey === 'obstruction') {
    return humanizeCategory(properties.CATOBS)
  }
  return undefined
}

/** Read a finite numeric property, treating null and non-numbers as absent. */
function readNumber (raw: unknown): number | undefined {
  return toFiniteNumber(raw) ?? undefined
}

/** Read a non-empty free-text property, treating null and blanks as absent. */
function readText (raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Render the popup HTML for one feature. The `layerKey` selects the
 * appropriate category field (CATWRK, CATOBS, or none) and the fallback
 * header label when OBJNAM is null. The `properties` bag is the raw
 * GeoJSON `feature.properties` from ArcGIS, untouched.
 */
export function renderEncDirectDetail (
  layerKey: EncLayerKey,
  properties: Record<string, unknown>
): string {
  const blocks: string[] = []

  const name = readText(properties.OBJNAM) ?? LAYER_LABEL[layerKey]
  const category = categoryLabel(layerKey, properties)
  const watlev = lookupCode(WATLEV, properties.WATLEV)
  const headerSuffix = [category, watlev]
    .filter((value): value is string => value !== undefined)
    .join(', ')
  const headerTail = headerSuffix.length > 0 ? ` (${escapeHtml(headerSuffix)})` : ''
  blocks.push(`<h4>${escapeHtml(name)}${headerTail}</h4>`)

  const valsou = readNumber(properties.VALSOU)
  if (valsou !== undefined) {
    const souacc = readNumber(properties.SOUACC)
    const accuracy = souacc !== undefined
      ? ` (sounding accuracy ±${souacc.toFixed(1)} m)`
      : ''
    blocks.push(`<p><strong>Charted depth:</strong> ${valsou.toFixed(1)} m${accuracy}.</p>`)
  }

  const quality = lookupCode(QUASOU, properties.QUASOU)
  if (quality !== undefined) {
    blocks.push(labeledParagraph('Position quality', quality))
  }

  const technique = lookupCode(TECSOU, properties.TECSOU)
  if (technique !== undefined) {
    blocks.push(labeledParagraph('Survey technique', technique))
  }

  const inform = readText(properties.INFORM)
  if (inform !== undefined) {
    blocks.push(labeledParagraph('Information', inform))
  }

  const dsnm = readText(properties.DSNM)
  const surveyed = formatSordatDisplay(properties.SORDAT)
  if (dsnm !== undefined) {
    const suffix = surveyed !== undefined ? ` (surveyed ${surveyed})` : ''
    blocks.push(`<p><strong>Source:</strong> NOAA ENC ${escapeHtml(dsnm)}${suffix}.</p>`)
  }

  blocks.push(`<p><strong>Disclaimer:</strong> ${DISCLAIMER}</p>`)
  return blocks.join('')
}
