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
import { ACTIVE_CAPTAIN_SOURCE_ID } from '../shared/source-ids.js'
import type { PoiSummary } from '../shared/types.js'

/**
 * The fixed base source: non-base POIs dedupe against ActiveCaptain. Aliased
 * to {@link ACTIVE_CAPTAIN_SOURCE_ID} so a future rename remains a single
 * edit in one place.
 */
const BASE_SOURCE_ID = ACTIVE_CAPTAIN_SOURCE_ID

/**
 * Default merge radius, in meters, when a caller does not specify one. Real
 * ActiveCaptain-vs-OpenSeaMap placements of the same physical feature are
 * routinely 80 to 250 meters apart, so the default is wide enough to catch
 * those without merging genuinely separate neighbors. A caller (typically the
 * input registry, reading the user's `openSeaMapDedupeRadiusMeters` setting)
 * can tighten or loosen this.
 */
export const DEFAULT_DEDUPE_RADIUS_METERS = 150

/**
 * Config-schema fragment for a non-base source's "merge duplicates of an
 * ActiveCaptain marker" toggle. Every non-base input declares an identical
 * boolean-defaulting-true toggle differing only in its title, so the shape
 * lives here next to the dedupe it controls.
 */
export function dedupeToggleSchema (title: string): Record<string, unknown> {
  return { type: 'boolean', title, default: true }
}

/**
 * Config-schema fragment for a non-base source's dedupe merge-radius field, in
 * meters. Defaults to {@link DEFAULT_DEDUPE_RADIUS_METERS}.
 */
export function dedupeRadiusSchema (title: string): Record<string, unknown> {
  return { type: 'number', title, default: DEFAULT_DEDUPE_RADIUS_METERS, minimum: 1 }
}

/** Meters per degree of latitude, used to project positions for the grid. */
const METERS_PER_DEGREE = 111320

/**
 * Multiplier used to pack two grid-cell coordinates into a single Map key.
 * Lat range -90..90 and lon range -180..180 at the smallest realistic dedupe
 * radius (1 m) yield cell coordinates well inside +/-2e7, so a 100_000_000
 * stride keeps `xCell * STRIDE + yCell` collision-free and still within
 * Number.MAX_SAFE_INTEGER (2^53). Avoiding string-template keys removes the
 * nine allocations per 3x3 neighbor probe per POI on the dedupe hot path.
 *
 * The stride assumes |yCell| < STRIDE / 2 and |xCell| < STRIDE / 2: at radius
 * below {@link MIN_SAFE_RADIUS_METERS} that bound can be violated, so
 * `dedupeAgainstBase` clamps the input radius to the safe minimum.
 */
const CELL_KEY_STRIDE = 100_000_000

/**
 * Smallest radius the cell packing supports without collision. The schema
 * enforces 1 m at the panel layer, but the dedupe function is also called
 * directly by the registry with the config value, so an out-of-range
 * radius is clamped here as a defense.
 */
const MIN_SAFE_RADIUS_METERS = 1

/** Pack (x, y) cell coordinates into a single integer suitable for a Map key. */
function packCellKey (x: number, y: number): number {
  return x * CELL_KEY_STRIDE + y
}

/** Per-source detail tracked for a surviving base POI as duplicates merge in. */
interface Corroboration {
  /** Contributing source slugs, base first, in merge order. */
  slugs: string[]
  /** Distinct attribution credit strings, base first, in merge order. */
  attributions: string[]
}

/**
 * The per-source merge radius the dedupe pass uses. A number is treated as a
 * uniform radius applied to every dedupe-enabled source. A map is the
 * per-source form the registry builds from each input's
 * `dedupeRadiusMeters(config)`: each non-base source's radius is looked up
 * by `poi.source`, falling back to {@link DEFAULT_DEDUPE_RADIUS_METERS}
 * for any source the map does not name.
 */
export type DedupeRadiusSpec = number | ReadonlyMap<string, number>

/** Resolve the radius for one source from the (number or map) spec. */
function radiusFor (source: string, spec: DedupeRadiusSpec): number {
  const raw = typeof spec === 'number' ? spec : (spec.get(source) ?? DEFAULT_DEDUPE_RADIUS_METERS)
  return raw < MIN_SAFE_RADIUS_METERS ? MIN_SAFE_RADIUS_METERS : raw
}

/**
 * The radius used to size the cell grid. Both grid scales (base and
 * per-source) must use the same projection so the 3x3 neighbor scan
 * remains exhaustive, so the largest configured radius wins. A per-source
 * scan with a tighter radius then narrows to its own distance check.
 */
function gridRadius (spec: DedupeRadiusSpec): number {
  if (typeof spec === 'number') {
    return spec < MIN_SAFE_RADIUS_METERS ? MIN_SAFE_RADIUS_METERS : spec
  }
  let max = DEFAULT_DEDUPE_RADIUS_METERS
  for (const value of spec.values()) {
    if (value > max) max = value
  }
  return max < MIN_SAFE_RADIUS_METERS ? MIN_SAFE_RADIUS_METERS : max
}

/**
 * Merge non-base POIs that coincide with a base ActiveCaptain POI.
 *
 * For each base POI (`source === BASE_SOURCE_ID`), any POI of the same
 * `PoiType` whose `source` is in `dedupeSources` and which lies within that
 * source's merge radius is dropped as a duplicate; the base POI is the
 * survivor. The surviving base POI's `sources` lists the base slug plus
 * every merged source, and its `attribution` credits each one. A
 * dedupe-enabled POI with no co-located base POI passes through unmerged
 * with `sources` set to its own source. A POI whose source is not in
 * `dedupeSources` is never merged or dropped.
 *
 * The radius spec may be a single number (uniform across every
 * dedupe-enabled source) or a `Map<sourceId, number>` (per-source: the
 * registry builds this from each input's `dedupeRadiusMeters`). Per-source
 * radii let a tight USCG merge coexist with a looser OpenSeaMap merge.
 *
 * The pass buckets POIs into a grid sized by the LARGEST radius across the
 * spec, so a per-source scan with a tighter radius still finds its
 * neighbors in a 3x3 sweep, then refines with the source's own radius for
 * the distance check.
 */
export function dedupeAgainstBase (
  pois: PoiSummary[],
  dedupeSources: ReadonlySet<string>,
  radiusSpec: DedupeRadiusSpec = DEFAULT_DEDUPE_RADIUS_METERS
): PoiSummary[] {
  if (pois.length === 0) {
    return pois
  }
  const cellRadius = gridRadius(radiusSpec)

  // Project longitude with a shared reference latitude so the grid is a
  // consistent metric: two points within `cellRadius` of each other land at
  // most one cell apart on each axis, so a 3x3 neighbor scan is exhaustive
  // at the LARGEST source radius. Both passes (base merge and same-source
  // collapse) use this projection.
  const meanLatRad =
    (pois.reduce((sum, poi) => sum + poi.position.latitude, 0) / pois.length) * Math.PI / 180
  const lonScale = METERS_PER_DEGREE * Math.cos(meanLatRad)
  /** Project a POI to its grid cell on the shared scale. */
  const cellCoords = (poi: PoiSummary): [number, number] => [
    Math.floor((poi.position.longitude * lonScale) / cellRadius),
    Math.floor((poi.position.latitude * METERS_PER_DEGREE) / cellRadius)
  ]

  const basePois = pois.filter((poi) => poi.source === BASE_SOURCE_ID)
  // With no base layer there is nothing to dedupe against: every POI passes
  // through, a dedupe-enabled one carrying its own source as its sole source.
  // The same-source pass still runs, so a source that tags one feature twice
  // collapses regardless of whether the base layer is present.
  if (basePois.length === 0) {
    const tagged = pois.map((poi) =>
      dedupeSources.has(poi.source) ? { ...poi, sources: [poi.source] } : poi)
    return dedupeSameSource(tagged, radiusSpec, cellCoords, dedupeSources)
  }

  // Bucket the base POIs by grid cell, and seed each one's corroboration with
  // its own source and attribution.
  const grid = new Map<number, PoiSummary[]>()
  const corroboration = new Map<PoiSummary, Corroboration>()
  for (const base of basePois) {
    const [x, y] = cellCoords(base)
    const key = packCellKey(x, y)
    const bucket = grid.get(key)
    if (bucket === undefined) {
      grid.set(key, [base])
    } else {
      bucket.push(base)
    }
    corroboration.set(base, { slugs: [base.source], attributions: [base.attribution] })
  }

  /** Find a base POI of the same type within `poi`'s source radius. */
  function baseMatch (poi: PoiSummary): PoiSummary | undefined {
    const [x, y] = cellCoords(poi)
    const radius = radiusFor(poi.source, radiusSpec)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(packCellKey(x + dx, y + dy))
        if (bucket === undefined) continue
        for (const base of bucket) {
          if (base.type === poi.type &&
            distanceMeters(base.position, poi.position) <= radius) {
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
  return [...baseSurvivors, ...dedupeSameSource(survivors, radiusSpec, cellCoords, dedupeSources)]
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
  radiusSpec: DedupeRadiusSpec,
  cellCoords: (poi: PoiSummary) => [number, number],
  dedupeSources: ReadonlySet<string>
): PoiSummary[] {
  if (pois.length <= 1) {
    return pois
  }
  // One grid per source: a POI from a different source never displaces one
  // from this one. The inner Map uses the bit-packed integer cell key (see
  // packCellKey) to avoid the per-probe string allocation the older
  // `${source}|${x},${y}` key carried. Only sources in `dedupeSources`
  // participate; a source whose dedupe toggle is off passes through
  // unmerged, so the user gets the raw, un-collapsed feed they asked for.
  const keptBySource = new Map<string, Map<number, PoiSummary[]>>()
  const out: PoiSummary[] = []
  for (const poi of pois) {
    if (!dedupeSources.has(poi.source)) {
      out.push(poi)
      continue
    }
    const [x, y] = cellCoords(poi)
    let sourceGrid = keptBySource.get(poi.source)
    if (sourceGrid === undefined) {
      sourceGrid = new Map<number, PoiSummary[]>()
      keptBySource.set(poi.source, sourceGrid)
    }
    const radius = radiusFor(poi.source, radiusSpec)
    if (hasNearbyDuplicate(poi, x, y, radius, sourceGrid)) {
      continue
    }
    out.push(poi)
    const key = packCellKey(x, y)
    const bucket = sourceGrid.get(key)
    if (bucket === undefined) {
      sourceGrid.set(key, [poi])
    } else {
      bucket.push(poi)
    }
  }
  return out
}

/**
 * True when a same-source same-type POI within `radiusMeters` of `poi` has
 * already been kept in `sourceGrid`. Sweeps the 3x3 neighborhood of the POI's
 * grid cell, which is exhaustive at this grid scale.
 */
function hasNearbyDuplicate (
  poi: PoiSummary,
  x: number,
  y: number,
  radiusMeters: number,
  sourceGrid: ReadonlyMap<number, PoiSummary[]>
): boolean {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = sourceGrid.get(packCellKey(x + dx, y + dy))
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
