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
  LAYER_LABEL,
  categoryLabel,
  encDepthLabel,
  formatSordatDisplay,
  humanizeCategory,
  lookupCode,
  lookupParsedCode,
  parseS57Code,
  readNumber
} from './s57-mapping.js'
import type { EncLayerKey } from './enc-direct-types.js'
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'
import { formatMeters } from '../../shared/format-meters.js'

/** NOAA's standard disclaimer for ENC data published through Coast Survey. */
const DISCLAIMER = 'NOAA ENC data is not intended for primary navigation.'

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

  const name = humanizeCategory(properties.OBJNAM) ?? LAYER_LABEL[layerKey]
  const category = categoryLabel(layerKey, properties)
  const watlev = lookupCode(WATLEV, properties.WATLEV)
  const headerSuffix = [category, watlev]
    .filter((value): value is string => value !== undefined)
    .join(', ')
  const headerTail = headerSuffix.length > 0 ? ` (${escapeHtml(headerSuffix)})` : ''
  blocks.push(`<h4>${escapeHtml(name)}${headerTail}</h4>`)

  // QUASOU drives both the depth label and the position-quality line, so it is
  // parsed once here and the parsed code feeds both.
  const quasou = parseS57Code(properties.QUASOU)
  const valsou = readNumber(properties.VALSOU)
  if (valsou !== undefined) {
    const souacc = readNumber(properties.SOUACC)
    const accuracy = souacc !== undefined
      ? ` (sounding accuracy ±${formatMeters(souacc)} m)`
      : ''
    // A least-depth sounding (QUASOU 6/7) reports the worst-case depth over the
    // feature, so the label says so; otherwise it is the charted depth. Both are
    // referenced to chart datum (MLLW on US ENCs). The section builder shares
    // this label via `encDepthLabel`, so the two cannot drift.
    const depthLabel = encDepthLabel(quasou)
    blocks.push(`<p><strong>${depthLabel}:</strong> ${formatMeters(valsou)} m${accuracy}.</p>`)
  }

  const quality = lookupParsedCode(QUASOU, quasou)
  if (quality !== undefined) {
    blocks.push(labeledParagraph('Position quality', quality))
  }

  const technique = lookupCode(TECSOU, properties.TECSOU)
  if (technique !== undefined) {
    blocks.push(labeledParagraph('Survey technique', technique))
  }

  const inform = humanizeCategory(properties.INFORM)
  if (inform !== undefined) {
    blocks.push(labeledParagraph('Information', inform))
  }

  const dsnm = humanizeCategory(properties.DSNM)
  const surveyed = formatSordatDisplay(properties.SORDAT)
  if (dsnm !== undefined) {
    const suffix = surveyed !== undefined ? ` (surveyed ${surveyed})` : ''
    blocks.push(`<p><strong>Source:</strong> NOAA ENC ${escapeHtml(dsnm)}${suffix}.</p>`)
  }

  blocks.push(`<p><strong>Disclaimer:</strong> ${DISCLAIMER}</p>`)
  return blocks.join('')
}
