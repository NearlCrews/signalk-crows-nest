/**
 * Country classification and foreign-water rings for border-aware route drafting.
 *
 * Loads the bundled, simplified admin-0 country polygons and answers: which country a position lies in
 * (classify), whether a route's two endpoints are in the same country (homeForRoute, the same-country
 * gate), and the polygons of every OTHER country overlapping a route bbox (foreignRings), which the nav
 * grid rasterizes as a blocker so a same-country route stays in its own waters. A missing or unparsable
 * asset degrades to a no-op service so route drafting never fails over this least-critical layer.
 *
 * The polygons partition only inland and boundary-lake water (the Great Lakes and their connecting
 * rivers); marine water is in no polygon, so a coastal point classifies as undefined and a coastal
 * route is never constrained. A misclassification only ever turns the constraint off, which is safe.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RingPolygon } from './channel-router/nav-grid.js'
import { pointInRings } from './leg-geometry.js'
import { bboxContainsPoint, bboxesOverlap, boundsOfRings } from '../geo/position-utilities.js'
import type { Bbox, Logger, Position } from '../shared/types.js'

export interface Country {
  id: string
  name: string
}

export interface CountryBoundaries {
  /** The country containing the position, or undefined for marine water or any uncovered point. */
  classify: (p: Position) => Country | undefined
  /** The home country when both endpoints are in the same country, else undefined (the same-country gate). */
  homeForRoute: (from: Position, to: Position) => Country | undefined
  /** Every other country's polygons overlapping `bbox`, as nav-grid RingPolygons, to block as foreign water. */
  foreignRings: (homeId: string, bbox: Bbox) => RingPolygon[]
}

/**
 * A polygon and its precomputed bbox. The bbox lets classify and foreignRings reject a far polygon
 * without walking its rings, which matters because a feature that crosses the antimeridian (the US,
 * Russia, Fiji) has a near-global feature bbox that would otherwise pull all of its distant polygons
 * into every test.
 */
interface BoundaryPolygon {
  rings: number[][][]
  bbox: Bbox
}

/** A parsed country: its id and name, its polygons, and its overall bbox. */
interface BoundaryFeature {
  id: string
  name: string
  polys: BoundaryPolygon[]
  bbox: Bbox
}

const NOOP: CountryBoundaries = {
  classify: () => undefined,
  homeForRoute: () => undefined,
  foreignRings: () => []
}

function featureBbox (polys: BoundaryPolygon[]): Bbox {
  let { north, south, east, west } = polys[0].bbox
  for (const p of polys) {
    if (p.bbox.north > north) north = p.bbox.north
    if (p.bbox.south < south) south = p.bbox.south
    if (p.bbox.east > east) east = p.bbox.east
    if (p.bbox.west < west) west = p.bbox.west
  }
  return { north, south, east, west }
}

interface RawFeature {
  properties?: { id?: string, name?: string }
  geometry?: { type?: string, coordinates?: unknown }
}

/**
 * Build the service from parsed GeoJSON features. Exported so tests construct from a small fixture
 * rather than the bundled asset.
 */
export function countryBoundariesFrom (rawFeatures: unknown): CountryBoundaries {
  const features: BoundaryFeature[] = []
  if (Array.isArray(rawFeatures)) {
    for (const f of rawFeatures as RawFeature[]) {
      const id = f.properties?.id
      const geom = f.geometry
      if (id === undefined || geom === undefined) continue
      let rawPolys: number[][][][] | undefined
      if (geom.type === 'Polygon') rawPolys = [geom.coordinates as number[][][]]
      else if (geom.type === 'MultiPolygon') rawPolys = geom.coordinates as number[][][][]
      if (rawPolys === undefined || rawPolys.length === 0) continue
      const polys = rawPolys.map((rings) => ({ rings, bbox: boundsOfRings(rings) }))
      features.push({ id, name: f.properties?.name ?? id, polys, bbox: featureBbox(polys) })
    }
  }
  if (features.length === 0) return NOOP

  const classify = (p: Position): Country | undefined => {
    for (const f of features) {
      if (!bboxContainsPoint(f.bbox, p.longitude, p.latitude)) continue
      // Test each polygon of a (multi)polygon separately (rejecting by its own bbox first), so an
      // exclave (a separate polygon inside another country, paired with a hole there) classifies right.
      for (const poly of f.polys) {
        if (!bboxContainsPoint(poly.bbox, p.longitude, p.latitude)) continue
        if (pointInRings(p.longitude, p.latitude, poly.rings)) return { id: f.id, name: f.name }
      }
    }
    return undefined
  }

  return {
    classify,
    homeForRoute (from, to) {
      const home = classify(from)
      return home !== undefined && home.id === classify(to)?.id ? home : undefined
    },
    foreignRings (homeId, bbox) {
      const out: RingPolygon[] = []
      for (const f of features) {
        if (f.id === homeId || !bboxesOverlap(f.bbox, bbox)) continue
        for (const poly of f.polys) {
          // Per-polygon bbox reject, so a far part of a large neighbor is never rasterized. No clipping:
          // fillPolygonCells already bounds its work to the grid, and clipping would add seam edges that
          // flip the even-odd scanline parity.
          if (bboxesOverlap(poly.bbox, bbox)) out.push({ rings: poly.rings })
        }
      }
      return out
    }
  }
}

/**
 * Load the bundled country asset, degrading to a no-op service on any problem so a packaging or data
 * fault never throws and disables route drafting. An absent asset logs at debug (an expected slim-build
 * degrade); an unreadable or unparsable one logs at error (a packaging bug worth surfacing).
 *
 * __dirname (CommonJS) is dist/route-draft at runtime; the asset sits at the package root under
 * assets/, two levels up, in both the dev tree and the published dist layout. This module is emitted as
 * CommonJS (the package has no "type": "module"); a switch to ESM would need import.meta.url here.
 */
export function loadCountryBoundaries (logger?: Logger): CountryBoundaries {
  const path = join(__dirname, '..', '..', 'assets', 'boundaries', 'countries.geojson')
  if (!existsSync(path)) {
    logger?.debug(`country boundaries asset absent, border-aware routing off: ${path}`)
    return NOOP
  }
  try {
    const fc = JSON.parse(readFileSync(path, 'utf8')) as { features?: unknown }
    return countryBoundariesFrom(fc.features)
  } catch (error) {
    logger?.error(`country boundaries asset unreadable, border-aware routing off: ${String(error)}`)
    return NOOP
  }
}
