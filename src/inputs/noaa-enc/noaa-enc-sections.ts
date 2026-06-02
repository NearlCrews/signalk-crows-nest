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
  formatSordatDisplay,
  humanizeCategory,
  lookupCode
} from './s57-mapping.js'
import type { EncFeature, EncLayerKey } from './enc-direct-types.js'
import { toFiniteNumber } from '../../shared/numbers.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/**
 * Resolve the humanized category label: CATWRK for a wreck, CATOBS for an
 * obstruction, none for a rock. Mirrors the renderer's `categoryLabel`.
 */
function categoryLabel (
  layerKey: EncLayerKey,
  properties: Record<string, unknown>
): string | undefined {
  if (layerKey === 'wreck') return humanizeCategory(properties.CATWRK)
  if (layerKey === 'obstruction') return humanizeCategory(properties.CATOBS)
  return undefined
}

/** Read a finite numeric property, treating null and non-numbers as absent. */
function readNumber (raw: unknown): number | undefined {
  return toFiniteNumber(raw) ?? undefined
}

/** Build the normalized detail sections for one ENC Direct feature. */
export function buildNoaaEncSections (
  layerKey: EncLayerKey,
  feature: EncFeature
): NormalizedSection[] {
  const properties = feature.properties
  const sections: NormalizedSection[] = []

  // Feature identity and classification: OBJNAM, the layer-specific category,
  // and the water level, the same trio the renderer puts in the popup header.
  const featureItems: NormalizedItem[] = []
  const name = humanizeCategory(properties.OBJNAM)
  if (name !== undefined) {
    featureItems.push({ label: 'Name', value: name, kind: 'text' })
  }
  const category = categoryLabel(layerKey, properties)
  if (category !== undefined) {
    featureItems.push({ label: 'Category', value: category, kind: 'text' })
  }
  const watlev = lookupCode(WATLEV, properties.WATLEV)
  if (watlev !== undefined) {
    featureItems.push({ label: 'Water level', value: watlev, kind: 'text' })
  }
  pushSection(sections, 'feature', 'Feature', featureItems)

  // Depth: the VALSOU charted depth and, only alongside it, the SOUACC
  // sounding accuracy. The renderer surfaces accuracy only with a sounding.
  const depth: NormalizedItem[] = []
  const valsou = readNumber(properties.VALSOU)
  if (valsou !== undefined) {
    depth.push({ label: 'Charted depth', value: valsou, kind: 'measure', unit: 'm' })
    const souacc = readNumber(properties.SOUACC)
    if (souacc !== undefined) {
      depth.push({ label: 'Sounding accuracy', value: souacc, kind: 'measure', unit: 'm' })
    }
  }
  pushSection(sections, 'depth', 'Depth', depth)

  // Survey quality: QUASOU position quality and TECSOU survey technique.
  const quality: NormalizedItem[] = []
  const positionQuality = lookupCode(QUASOU, properties.QUASOU)
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
