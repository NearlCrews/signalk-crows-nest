/**
 * Per-source POI dedupe against the ActiveCaptain base layer, plus a
 * same-source pass that collapses internal duplicates.
 *
 * With more than one source enabled, the same physical marina, hazard, or lock
 * can appear as separate markers a few meters apart. ActiveCaptain is the fixed
 * "base" layer. A non-base POI of the same `PoiType` within a small radius of a
 * base POI is treated as the same feature: it is dropped, and the base POI
 * survives, recording every contributing source as a corroboration signal.
 *
 * After the base-vs-non-base pass, a same-source pass collapses non-base
 * duplicates of the same `PoiType` within the same radius. The first occurrence
 * in input order wins; a dropped duplicate carries no cross-source attribution
 * (it came from the same source), so it is simply removed. This catches the
 * case where a single source (OpenSeaMap most commonly) tags one physical
 * feature twice, e.g. an OSM node and an OSM way for the same harbour.
 *
 * Absence of corroboration is NOT a negative signal, since source coverage is
 * uneven, so it is surfaced only as confidence-up: a base POI with no merged
 * duplicate simply lists its own source.
 */

import { distanceMeters } from '../geo/position-utilities.js'
import type { PoiSummary } from '../shared/types.js'

/** The fixed base source. Non-base POIs dedupe against ActiveCaptain POIs. */
export const BASE_SOURCE_ID = 'activecaptain'

/**
 * Default merge radius, in meters, when a caller does not specify one. Real
 * ActiveCaptain-vs-OpenSeaMap placements of the same physical feature are
 * routinely 80 to 250 meters apart, so the default is wide enough to catch
 * those without merging genuinely separate neighbors. A caller (typically the
 * input registry, reading the user's `openSeaMapDedupeRadiusMeters` setting)
 * can tighten or loosen this.
 */
export const DEFAULT_DEDUPE_RADIUS_METERS = 150

/** Meters per degree of latitude, used to project positions for the grid. */
const METERS_PER_DEGREE = 111320

/** Per-source detail tracked for a surviving base POI as duplicates merge in. */
interface Corroboration {
  /** Contributing source slugs, base first, in merge order. */
  slugs: string[]
  /** Distinct attribution credit strings, base first, in merge order. */
  attributions: string[]
}

/**
 * Merge non-base POIs that coincide with a base ActiveCaptain POI.
 *
 * For each base POI (`source === BASE_SOURCE_ID`), any POI of the same
 * `PoiType` within `radiusMeters` whose `source` is in `dedupeSources` is
 * dropped as a duplicate; the base POI is the survivor. The surviving base
 * POI's `sources` lists the base slug plus every merged source, and its
 * `attribution` credits each one. A dedupe-enabled POI with no co-located base
 * POI passes through unmerged with `sources` set to its own source. A POI
 * whose source is not in `dedupeSources` is never merged or dropped.
 *
 * The pass buckets POIs into a grid of `radiusMeters`-sided cells, so it runs
 * linearly in the POI count rather than quadratically.
 */
export function dedupeAgainstBase (
  pois: PoiSummary[],
  dedupeSources: ReadonlySet<string>,
  radiusMeters: number = DEFAULT_DEDUPE_RADIUS_METERS
): PoiSummary[] {
  if (pois.length === 0) {
    return pois
  }

  // Project longitude with a shared reference latitude so the grid is a
  // consistent metric: two points within radiusMeters of each other land at
  // most one cell apart on each axis, so a 3x3 neighbor scan is exhaustive.
  // Both passes (base merge and same-source collapse) use this projection.
  const meanLatRad =
    (pois.reduce((sum, poi) => sum + poi.position.latitude, 0) / pois.length) * Math.PI / 180
  const lonScale = METERS_PER_DEGREE * Math.cos(meanLatRad)
  /** Project a POI to its grid cell on the shared scale. */
  const cellCoords = (poi: PoiSummary): [number, number] => [
    Math.floor((poi.position.longitude * lonScale) / radiusMeters),
    Math.floor((poi.position.latitude * METERS_PER_DEGREE) / radiusMeters)
  ]

  const basePois = pois.filter((poi) => poi.source === BASE_SOURCE_ID)
  // With no base layer there is nothing to dedupe against: every POI passes
  // through, a dedupe-enabled one carrying its own source as its sole source.
  // The same-source pass still runs, so a source that tags one feature twice
  // collapses regardless of whether the base layer is present.
  if (basePois.length === 0) {
    const tagged = pois.map((poi) =>
      dedupeSources.has(poi.source) ? { ...poi, sources: [poi.source] } : poi)
    return dedupeSameSource(tagged, radiusMeters, cellCoords)
  }

  // Bucket the base POIs by grid cell, and seed each one's corroboration with
  // its own source and attribution.
  const grid = new Map<string, PoiSummary[]>()
  const corroboration = new Map<PoiSummary, Corroboration>()
  for (const base of basePois) {
    const [x, y] = cellCoords(base)
    const key = `${x},${y}`
    const bucket = grid.get(key)
    if (bucket === undefined) {
      grid.set(key, [base])
    } else {
      bucket.push(base)
    }
    corroboration.set(base, { slugs: [base.source], attributions: [base.attribution] })
  }

  /** Find a base POI of the same type within radiusMeters of `poi`. */
  function baseMatch (poi: PoiSummary): PoiSummary | undefined {
    const [x, y] = cellCoords(poi)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${x + dx},${y + dy}`)
        if (bucket === undefined) continue
        for (const base of bucket) {
          if (base.type === poi.type &&
            distanceMeters(base.position, poi.position) <= radiusMeters) {
            return base
          }
        }
      }
    }
    return undefined
  }

  // Non-base POIs: merge a dedupe-enabled duplicate into its base, otherwise
  // keep it.
  const survivors: PoiSummary[] = []
  for (const poi of pois) {
    if (poi.source === BASE_SOURCE_ID) {
      continue
    }
    if (!dedupeSources.has(poi.source)) {
      // Not a dedupe-enabled source: never merged or dropped.
      survivors.push(poi)
      continue
    }
    const base = baseMatch(poi)
    if (base === undefined) {
      // Dedupe-enabled but no co-located base POI: pass through unmerged.
      survivors.push({ ...poi, sources: [poi.source] })
      continue
    }
    const merged = corroboration.get(base)
    if (merged !== undefined && !merged.slugs.includes(poi.source)) {
      merged.slugs.push(poi.source)
      if (!merged.attributions.includes(poi.attribution)) {
        merged.attributions.push(poi.attribution)
      }
    }
  }

  // Emit the base POIs (always survivors) with their final corroboration, then
  // the surviving non-base POIs after the same-source collapse. Every base POI
  // was seeded in the loop above, so corroboration.get(base) is always defined;
  // the non-null assertion is safe and documents that invariant.
  const baseSurvivors = basePois.map((base): PoiSummary => {
    const merged = corroboration.get(base) as Corroboration
    return { ...base, sources: merged.slugs, attribution: merged.attributions.join('; ') }
  })
  return [...baseSurvivors, ...dedupeSameSource(survivors, radiusMeters, cellCoords)]
}

/**
 * Collapse same-source same-type POIs within `radiusMeters` into the first
 * occurrence. A single source occasionally tags one physical feature twice
 * (OpenSeaMap regularly tags a harbour as both a node and a way); after the
 * base merge those duplicates are still visible to the chart, so this pass
 * trims them. Cross-source duplicates have already been collapsed against the
 * base layer; this is strictly intra-source.
 */
function dedupeSameSource (
  pois: PoiSummary[],
  radiusMeters: number,
  cellCoords: (poi: PoiSummary) => [number, number]
): PoiSummary[] {
  if (pois.length <= 1) {
    return pois
  }
  // Keyed by `${source}|${x},${y}`: each source has its own grid, so a POI
  // from a different source never displaces one from this one.
  const keptByCell = new Map<string, PoiSummary[]>()
  const out: PoiSummary[] = []
  for (const poi of pois) {
    const [x, y] = cellCoords(poi)
    if (hasNearbyDuplicate(poi, x, y, radiusMeters, keptByCell)) {
      continue
    }
    out.push(poi)
    const key = `${poi.source}|${x},${y}`
    const bucket = keptByCell.get(key)
    if (bucket === undefined) {
      keptByCell.set(key, [poi])
    } else {
      bucket.push(poi)
    }
  }
  return out
}

/**
 * True when a same-source same-type POI within `radiusMeters` of `poi` has
 * already been kept in `keptByCell`. Sweeps the 3x3 neighborhood of the POI's
 * grid cell, which is exhaustive at this grid scale.
 */
function hasNearbyDuplicate (
  poi: PoiSummary,
  x: number,
  y: number,
  radiusMeters: number,
  keptByCell: ReadonlyMap<string, PoiSummary[]>
): boolean {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = keptByCell.get(`${poi.source}|${x + dx},${y + dy}`)
      if (bucket === undefined) continue
      for (const kept of bucket) {
        if (kept.type === poi.type &&
          distanceMeters(kept.position, poi.position) <= radiusMeters) {
          return true
        }
      }
    }
  }
  return false
}
