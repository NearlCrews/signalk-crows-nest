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
  humanizeCategory,
  lookupCode
} from './s57-mapping.js'
import type { EncLayerKey } from './enc-direct-types.js'

/** Layer-derived fallback header label when OBJNAM is null or absent. */
const LAYER_LABEL: Readonly<Record<EncLayerKey, string>> = {
  wreck: 'Wreck',
  obstruction: 'Obstruction',
  rock: 'Rock'
}

/** NOAA's standard disclaimer for ENC data published through Coast Survey. */
const DISCLAIMER = 'NOAA ENC data is not intended for primary navigation.'

/** Escape the four HTML-significant characters in a free-text value. */
function escapeHtml (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Format the S-57 `SORDAT` "source date" field: the date the underlying
 * hydrographic survey was issued or compiled, NOT the date NOAA last refreshed
 * the chart. For most wrecks and obstructions this is the original survey
 * date, often decades old, and stays fixed until a re-survey. The wire
 * publishes both six-character `YYYYMM` and eight-character `YYYYMMDD` forms;
 * the renderer preserves whichever precision the upstream sent rather than
 * silently dropping the day. Anything else (null, non-string, wrong length)
 * returns undefined so the renderer can omit the suffix.
 */
function formatSordat (raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  if (trimmed.length === 8) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  }
  if (trimmed.length === 6) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}`
  }
  return undefined
}

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
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
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
    const accuracy = souacc !== undefined ? ` (sounding accuracy ±${souacc} m)` : ''
    blocks.push(`<p><strong>Charted depth:</strong> ${valsou} m${accuracy}.</p>`)
  }

  const quality = lookupCode(QUASOU, properties.QUASOU)
  if (quality !== undefined) {
    blocks.push(`<p><strong>Position quality:</strong> ${escapeHtml(quality)}.</p>`)
  }

  const technique = lookupCode(TECSOU, properties.TECSOU)
  if (technique !== undefined) {
    blocks.push(`<p><strong>Survey technique:</strong> ${escapeHtml(technique)}.</p>`)
  }

  const inform = readText(properties.INFORM)
  if (inform !== undefined) {
    blocks.push(`<p><strong>Information:</strong> ${escapeHtml(inform)}</p>`)
  }

  const dsnm = readText(properties.DSNM)
  const surveyed = formatSordat(properties.SORDAT)
  if (dsnm !== undefined) {
    const suffix = surveyed !== undefined ? ` (surveyed ${surveyed})` : ''
    blocks.push(`<p><strong>Source:</strong> NOAA ENC ${escapeHtml(dsnm)}${suffix}.</p>`)
  }

  blocks.push(`<p><strong>Disclaimer:</strong> ${DISCLAIMER}</p>`)
  return blocks.join('')
}
