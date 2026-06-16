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
import { METERS_PER_DEGREE } from '../shared/length.js'
import { ACTIVE_CAPTAIN_SOURCE_ID } from '../shared/source-ids.js'
import {
  DEFAULT_DEDUPE_RADIUS_METERS,
  MAX_DEDUPE_RADIUS_METERS,
  MIN_DEDUPE_RADIUS_METERS
} from '../shared/dedupe-radius.js'
import { boundedNumberSchema } from '../shared/config-schema.js'
import type { PoiSummary, PoiType, Position } from '../shared/types.js'

/**
 * The fixed base source: non-base POIs dedupe against ActiveCaptain. Aliased
 * to {@link ACTIVE_CAPTAIN_SOURCE_ID} so a future rename remains a single
 * edit in one place.
 */
const BASE_SOURCE_ID = ACTIVE_CAPTAIN_SOURCE_ID

// The default merge radius (150 feet, about 46 m, tight enough that two
// genuine neighbors are never merged away by default; widen it per source to
// catch larger cross-source placement gaps) and the one-meter minimum the
// cell packing needs to stay collision-free are owned by
// src/shared/dedupe-radius.ts. The minimum doubles as a defensive clamp in
// `dedupeAgainstBase`, since the dedupe function is also called directly by
// the registry with the raw config value, not only through the
// schema-validated panel.

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
  return boundedNumberSchema(
    title, DEFAULT_DEDUPE_RADIUS_METERS, MIN_DEDUPE_RADIUS_METERS, MAX_DEDUPE_RADIUS_METERS
  )
}

/**
 * Multiplier used to pack two grid-cell coordinates into a single Map key.
 * Lat range -90..90 and lon range -180..180 at the smallest realistic dedupe
 * radius (1 m) yield cell coordinates well inside +/-2e7, so a 100_000_000
 * stride keeps `xCell * STRIDE + yCell` collision-free and still within
 * Number.MAX_SAFE_INTEGER (2^53). Avoiding string-template keys removes the
 * nine allocations per 3x3 neighbor probe per POI on the dedupe hot path.
 *
 * The stride assumes |yCell| < STRIDE / 2 and |xCell| < STRIDE / 2: at radius
 * below {@link MIN_DEDUPE_RADIUS_METERS} that bound can be violated, so
 * `dedupeAgainstBase` clamps the input radius to the safe minimum.
 */
const CELL_KEY_STRIDE = 100_000_000

/** Pack (x, y) cell coordinates into a single integer suitable for a Map key. */
function packCellKey (x: number, y: number): number {
  return x * CELL_KEY_STRIDE + y
}

/**
 * The first POI of `type` within `radius` of `position` already bucketed in
 * `grid`, scanning the 3x3 neighborhood of cell `(x, y)`. The sweep is
 * exhaustive at this grid scale: two points within `radius` of each other land
 * at most one cell apart on each axis. Returns undefined when none matches.
 * Shared by the base-merge and same-source passes, whose neighbor scans are
 * the same shape.
 */
function scanNeighborhood (
  grid: ReadonlyMap<number, PoiSummary[]>,
  x: number,
  y: number,
  type: PoiType,
  position: Position,
  radius: number
): PoiSummary | undefined {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = grid.get(packCellKey(x + dx, y + dy))
      if (bucket === undefined) continue
      for (const candidate of bucket) {
        if (candidate.type === type &&
          distanceMeters(candidate.position, position) <= radius) {
          return candidate
        }
      }
    }
  }
  return undefined
}

/** Append `value` to the array bucketed at `key` in `map`, creating it if absent. */
function pushToBucket (
  map: Map<number, PoiSummary[]>,
  key: number,
  value: PoiSummary
): void {
  const bucket = map.get(key)
  if (bucket === undefined) {
    map.set(key, [value])
  } else {
    bucket.push(value)
  }
}

/** Per-source detail tracked for a surviving base POI as duplicates merge in. */
interface Corroboration {
  /** Contributing source slugs, base first, in merge order. */
  slugs: string[]
  /** Distinct attribution credit strings, base first, in merge order. */
  attributions: string[]
  /**
   * The most conservative (smallest) vertical clearance, in meters, reported
   * by the base POI or any merged duplicate. Undefined when none of them
   * carried a clearance.
   */
  clearance: number | undefined
}

/**
 * Fold a candidate vertical clearance into the running minimum, treating
 * `undefined` as "no value." The smaller clearance wins, so a survivor warns
 * against the lowest clearance any contributing source reported: the bridge
 * air-draft check is a safety comparison, so the conservative value is kept.
 */
function minClearance (
  current: number | undefined,
  candidate: number | undefined
): number | undefined {
  if (candidate === undefined) return current
  if (current === undefined) return candidate
  return candidate < current ? candidate : current
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
  return raw < MIN_DEDUPE_RADIUS_METERS ? MIN_DEDUPE_RADIUS_METERS : raw
}

/**
 * The radius used to size the cell grid. Both grid scales (base and
 * per-source) must use the same projection so the 3x3 neighbor scan
 * remains exhaustive, so the largest configured radius wins. A per-source
 * scan with a tighter radius then narrows to its own distance check.
 */
function gridRadius (spec: DedupeRadiusSpec): number {
  if (typeof spec === 'number') {
    return spec < MIN_DEDUPE_RADIUS_METERS ? MIN_DEDUPE_RADIUS_METERS : spec
  }
  let max = DEFAULT_DEDUPE_RADIUS_METERS
  for (const value of spec.values()) {
    if (value > max) max = value
  }
  return max < MIN_DEDUPE_RADIUS_METERS ? MIN_DEDUPE_RADIUS_METERS : max
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
    pushToBucket(grid, packCellKey(x, y), base)
    corroboration.set(base, {
      slugs: [base.source],
      attributions: [base.attribution],
      clearance: base.verticalClearanceMeters
    })
  }

  /** Find a base POI of the same type within `poi`'s source radius. */
  function baseMatch (poi: PoiSummary): PoiSummary | undefined {
    const [x, y] = cellCoords(poi)
    const radius = radiusFor(poi.source, radiusSpec)
    return scanNeighborhood(grid, x, y, poi.type, poi.position, radius)
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
    if (merged !== undefined) {
      if (!merged.slugs.includes(poi.source)) {
        merged.slugs.push(poi.source)
        if (!merged.attributions.includes(poi.attribution)) {
          merged.attributions.push(poi.attribution)
        }
      }
      // Fold every merged duplicate's clearance, including a second duplicate
      // from a source already credited above, so the survivor keeps the most
      // conservative clearance any of them reported.
      merged.clearance = minClearance(merged.clearance, poi.verticalClearanceMeters)
    }
  }

  // Emit the base POIs (always survivors) with their final corroboration, then
  // the surviving non-base POIs after the same-source collapse. Every base POI
  // was seeded in the loop above, so corroboration.get(base) is always defined;
  // the non-null assertion is safe and documents that invariant.
  const baseSurvivors = basePois.map((base): PoiSummary => {
    const merged = corroboration.get(base) as Corroboration
    // The folded clearance overrides the base's own value (it is the minimum
    // across the base and every merged duplicate). When none carried one the
    // spread adds nothing, so the field stays absent rather than re-emitting
    // the base's missing value.
    return {
      ...base,
      sources: merged.slugs,
      attribution: merged.attributions.join('; '),
      ...(merged.clearance !== undefined && { verticalClearanceMeters: merged.clearance })
    }
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
    const kept = scanNeighborhood(sourceGrid, x, y, poi.type, poi.position, radius)
    if (kept !== undefined) {
      // Collapse this duplicate into the kept survivor, folding its clearance
      // so the survivor keeps the most conservative clearance the pair
      // reported. `kept` was already pushed to `out` on the iteration that
      // placed it, so this mutates the already-emitted survivor in place. Only
      // write a defined result, so a pair that both lack a clearance leaves the
      // field absent rather than present-undefined.
      const folded = minClearance(kept.verticalClearanceMeters, poi.verticalClearanceMeters)
      if (folded !== undefined) {
        kept.verticalClearanceMeters = folded
      }
      continue
    }
    out.push(poi)
    pushToBucket(sourceGrid, packCellKey(x, y), poi)
  }
  return out
}
