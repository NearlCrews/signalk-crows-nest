/**
 * Normalized-section builder for one NOAA ENC Direct feature.
 *
 * Turns a raw ENC Direct feature (its layer key plus the S-57 `properties`
 * bag the ArcGIS service emits) into the source-agnostic
 * {@link NormalizedSection}[] a structured chart plotter renders, carried on
 * the note's `properties.crowsNest.sections` alongside the HTML description.
 *
 * It mirrors the same S-57 attributes `enc-direct-detail.ts`'s HTML renderer
 * surfaces, through the same `s57-mapping.ts` helpers (so the humanized values
 * cannot drift), but emits structured items rather than markup. The wire
 * ships most S-57 fields as `null` on a given feature and OBJNAM frequently
 * null, so every field is skipped when absent and an empty section is dropped,
 * matching the renderer's null-skipping. Only the static NOAA disclaimer the
 * renderer appends is intentionally not carried, as it is boilerplate rather
 * than feature data.
 */

import {
  WATLEV,
  QUASOU,
  TECSOU,
  categoryLabel,
  classifyDangerous,
  encDepthLabel,
  formatSordatDisplay,
  humanizeCategory,
  lookupCode,
  lookupParsedCode,
  parseS57Code,
  readNumber
} from './s57-mapping.js'
import type { EncFeature, EncLayerKey } from './enc-direct-types.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/** Build the normalized detail sections for one ENC Direct feature. */
export function buildNoaaEncSections (
  layerKey: EncLayerKey,
  feature: EncFeature
): NormalizedSection[] {
  const properties = feature.properties
  const sections: NormalizedSection[] = []

  // Feature identity and classification. For a hazard the safety-critical lead
  // is whether it is a dangerous or non-dangerous feature, so when the category
  // decodes to a danger word it leads as a `flag` a consumer can surface
  // prominently. A descriptive category that carries no danger word (e.g.
  // "foul ground", "wreck showing mast") stays a plain Category text item.
  const featureItems: NormalizedItem[] = []
  const category = categoryLabel(layerKey, properties)
  const dangerous = classifyDangerous(category)
  if (dangerous !== undefined) {
    featureItems.push({ label: 'Dangerous', value: dangerous, kind: 'flag' })
  }
  const name = humanizeCategory(properties.OBJNAM)
  if (name !== undefined) {
    featureItems.push({ label: 'Name', value: name, kind: 'text' })
  }
  if (category !== undefined && dangerous === undefined) {
    featureItems.push({ label: 'Category', value: category, kind: 'text' })
  }
  pushSection(sections, 'feature', 'Feature', featureItems)

  // Depth: the VALSOU sounding, the water level kept adjacent to it (the depth
  // state qualifies the number, e.g. an "awash" feature with no charted
  // sounding still carries depth-state information), and, only alongside a
  // present sounding, the SOUACC sounding accuracy. The depth label calls out a
  // least-depth sounding (the worst case over the feature) and the chart datum.
  // QUASOU drives both the depth label and the position-quality lookup, so it is
  // parsed once here and the parsed code feeds both.
  const quasou = parseS57Code(properties.QUASOU)
  const depth: NormalizedItem[] = []
  const valsou = readNumber(properties.VALSOU)
  if (valsou !== undefined) {
    depth.push({ label: encDepthLabel(quasou), value: valsou, kind: 'measure', unit: 'm' })
  }
  const watlev = lookupCode(WATLEV, properties.WATLEV)
  if (watlev !== undefined) {
    depth.push({ label: 'Water level', value: watlev, kind: 'text' })
  }
  if (valsou !== undefined) {
    const souacc = readNumber(properties.SOUACC)
    if (souacc !== undefined) {
      depth.push({ label: 'Sounding accuracy', value: souacc, kind: 'measure', unit: 'm' })
    }
  }
  pushSection(sections, 'depth', 'Depth', depth)

  // Survey quality: QUASOU position quality and TECSOU survey technique.
  const quality: NormalizedItem[] = []
  const positionQuality = lookupParsedCode(QUASOU, quasou)
  if (positionQuality !== undefined) {
    quality.push({ label: 'Position quality', value: positionQuality, kind: 'text' })
  }
  const technique = lookupCode(TECSOU, properties.TECSOU)
  if (technique !== undefined) {
    quality.push({ label: 'Survey technique', value: technique, kind: 'text' })
  }
  pushSection(sections, 'quality', 'Quality', quality)

  // The INFORM free-text note.
  const inform = humanizeCategory(properties.INFORM)
  if (inform !== undefined) {
    pushSection(sections, 'information', 'Information', [
      { label: 'Information', value: inform, kind: 'note' }
    ])
  }

  // Source provenance: the DSNM dataset and the SORDAT survey date (at the
  // wire's own precision, YYYY-MM or YYYY-MM-DD).
  const source: NormalizedItem[] = []
  const dataset = humanizeCategory(properties.DSNM)
  if (dataset !== undefined) {
    source.push({ label: 'Dataset', value: dataset, kind: 'text' })
  }
  const surveyed = formatSordatDisplay(properties.SORDAT)
  if (surveyed !== undefined) {
    source.push({ label: 'Surveyed', value: surveyed, kind: 'text' })
  }
  pushSection(sections, 'source', 'Source', source)

  return sections
}
