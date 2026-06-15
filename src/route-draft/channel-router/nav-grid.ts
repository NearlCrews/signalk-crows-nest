import type { Bbox, Position } from '../../shared/types.js'
import type { ChartedAreas } from '../../inputs/noaa-enc/depth-area-query.js'
import { METERS_PER_DEGREE, metersPerDegreeLon } from '../../shared/length.js'
import type { AStarGrid } from './astar.js'

/** Standoff cost weight: the step-cost multiplier at zero clearance, ramping to 0 at the desired offing. */
const STANDOFF_WEIGHT = 6
/** Default target cell size in meters; a larger bbox coarsens from here. */
export const DEFAULT_CELL_METERS = 60
/** Cell-count ceiling; a larger bbox coarsens until it fits. */
export const MAX_CELLS = 250_000
/** Cell-size ceiling; a route so large it would need coarser cells than this is declined (too coarse to resolve a channel). */
export const MAX_CELL_METERS = 250
/** Check the deadline this often during the synchronous passes. */
const DEADLINE_CHECK_CELLS = 8192

/** A polygon as GeoJSON `[lon, lat]` rings (outer first, then holes); the shape both sources share. */
export interface RingPolygon {
  rings: number[][][]
}

export interface NavGridParams {
  bbox: Bbox
  charted: ChartedAreas
  /**
   * OSM navigable WATER polygons (depth-unknown), worldwide. They mark coverage only;
   * they never block, so an ENC-charted block on the same cell still wins.
   */
  osmWater?: RingPolygon[]
  /**
   * OSM LAND blockers (islands mapped as their own feature, explicit land), worldwide.
   * They block exactly like an ENC land area, so an island inside an OSM water body
   * that is not modeled as a hole still blocks.
   */
  osmLand?: RingPolygon[]
  draftMeters: number
  safetyMarginMeters: number
  /** Desired offing in meters for the soft mid-channel cost; 0 disables the standoff bias. */
  standoffMeters: number
  /** Optimize corridor: only cells within halfWidthMeters of the polyline are navigable. */
  corridor?: { polyline: Position[], halfWidthMeters: number }
  targetCellMeters?: number
  /** Wall-clock deadline; the build bails to an empty grid if it passes. */
  deadlineMs?: number
}

export interface NavGrid extends AStarGrid {
  cellCenter: (col: number, row: number) => Position
  cellOf: (p: Position) => [number, number]
  /** The final (possibly coarsened) cell size in meters. */
  cellMeters: number
  /** True when at least one cell is navigable; false means the router must decline. */
  hasWater: boolean
}

/** A safe all-blocked 1x1 grid for the decline paths (degenerate bbox, too-coarse, or deadline). */
function emptyGrid (bbox: Bbox): NavGrid {
  const center: Position = { longitude: (bbox.east + bbox.west) / 2, latitude: (bbox.north + bbox.south) / 2 }
  return {
    cols: 1,
    rows: 1,
    isNavigable: () => false,
    stepPenalty: () => 0,
    cellCenter: () => center,
    cellOf: () => [0, 0],
    cellMeters: DEFAULT_CELL_METERS,
    hasWater: false
  }
}

/** The resolved grid dimensions for a bbox: column and row counts and the cell size in meters. */
export interface GridSize {
  cols: number
  rows: number
  cell: number
}

/**
 * Resolve the grid dimensions for a bbox, or null when it cannot be gridded: a
 * degenerate or antimeridian-crossing window (east <= west), a non-finite span, or a
 * window so large that fitting the cell-count cap forces a cell above the size floor
 * (too coarse to resolve a channel). Shared with the channel router so it can decline
 * before any fetch exactly when the grid would, rather than fetching and then failing.
 */
export function resolveGridSize (bbox: Bbox, targetCellMeters?: number): GridSize | null {
  const lonSpanDeg = bbox.east - bbox.west
  const latSpanDeg = bbox.north - bbox.south
  if (!(lonSpanDeg > 0) || !(latSpanDeg > 0) || !Number.isFinite(lonSpanDeg) || !Number.isFinite(latSpanDeg)) {
    return null
  }
  const midLat = (bbox.north + bbox.south) / 2
  const widthMeters = lonSpanDeg * metersPerDegreeLon(midLat)
  const heightMeters = latSpanDeg * METERS_PER_DEGREE
  let cell = targetCellMeters ?? DEFAULT_CELL_METERS
  let cols = Math.max(1, Math.ceil(widthMeters / cell))
  let rows = Math.max(1, Math.ceil(heightMeters / cell))
  while (cols * rows > MAX_CELLS) {
    cell *= 1.5
    cols = Math.max(1, Math.ceil(widthMeters / cell))
    rows = Math.max(1, Math.ceil(heightMeters / cell))
  }
  if (cell > MAX_CELL_METERS) return null
  return { cols, rows, cell }
}

export function buildNavGrid (params: NavGridParams): NavGrid {
  const { bbox, charted, draftMeters, safetyMarginMeters, standoffMeters, deadlineMs } = params
  const size = resolveGridSize(bbox, params.targetCellMeters)
  if (size === null) return emptyGrid(bbox)
  const { cols, rows, cell } = size
  const lonSpanDeg = bbox.east - bbox.west
  const latSpanDeg = bbox.north - bbox.south
  const midLat = (bbox.north + bbox.south) / 2

  const lonOf = (col: number): number => bbox.west + ((col + 0.5) / cols) * lonSpanDeg
  const latOf = (row: number): number => bbox.north - ((row + 0.5) / rows) * latSpanDeg
  const cellCenter = (col: number, row: number): Position => ({ longitude: lonOf(col), latitude: latOf(row) })
  const cellOf = (p: Position): [number, number] => {
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((p.longitude - bbox.west) / lonSpanDeg) * cols)))
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((bbox.north - p.latitude) / latSpanDeg) * rows)))
    return [col, row]
  }
  // Fractional column/row of a coordinate, for the scanline rasterizer.
  const colF = (lon: number): number => ((lon - bbox.west) / lonSpanDeg) * cols
  const rowF = (lat: number): number => ((bbox.north - lat) / latSpanDeg) * rows

  const contour = draftMeters + safetyMarginMeters
  const covered = new Uint8Array(cols * rows)
  const blocked = new Uint8Array(cols * rows)
  const overDeadline = (): boolean => deadlineMs !== undefined && Date.now() > deadlineMs

  // A Depth_Area marks coverage; it also blocks when its DRVAL1 is unknown, drying (<0), or shallower
  // than the contour (sticky OR across overlapping bands: a later deep stamp never clears a block). A
  // Land_Area always blocks.
  for (const area of charted.depthAreas) {
    const drval1 = area.depthRange?.shallowMeters
    const tooShallow = drval1 === undefined || drval1 < contour
    if (fillPolygonCells(area.rings, colF, rowF, cols, rows, (i) => { covered[i] = 1; if (tooShallow) blocked[i] = 1 }, deadlineMs)) {
      return emptyGrid(bbox)
    }
  }
  for (const area of charted.landAreas) {
    if (fillPolygonCells(area.rings, colF, rowF, cols, rows, (i) => { blocked[i] = 1 }, deadlineMs)) {
      return emptyGrid(bbox)
    }
  }

  // OSM worldwide layer: water marks coverage only (depth-unknown, never blocks, so
  // an ENC-charted block on the same cell still wins), and land blocks exactly like an
  // ENC land area (an island mapped as its own feature, not as a water hole, blocks).
  // Both stamp before the single navigable derivation, so any block wins regardless of
  // source order.
  for (const poly of params.osmWater ?? []) {
    if (fillPolygonCells(poly.rings, colF, rowF, cols, rows, (i) => { covered[i] = 1 }, deadlineMs)) {
      return emptyGrid(bbox)
    }
  }
  for (const poly of params.osmLand ?? []) {
    if (fillPolygonCells(poly.rings, colF, rowF, cols, rows, (i) => { blocked[i] = 1 }, deadlineMs)) {
      return emptyGrid(bbox)
    }
  }

  const navigable = new Uint8Array(cols * rows)
  let hasWater = false
  for (let i = 0; i < navigable.length; i += 1) {
    if (covered[i] === 1 && blocked[i] === 0) { navigable[i] = 1; hasWater = true }
  }

  // Optimize corridor: restrict to cells within halfWidthMeters of the drawn polyline (planar distance).
  if (params.corridor !== undefined && hasWater) {
    const half = params.corridor.halfWidthMeters
    const pts = params.corridor.polyline
    const mx = metersPerDegreeLon(midLat)
    const my = METERS_PER_DEGREE
    hasWater = false
    for (let r = 0; r < rows; r += 1) {
      if (overDeadline()) return emptyGrid(bbox)
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c
        if (navigable[i] === 0) continue
        if (planarPointToPolylineMeters(cellCenter(c, r), pts, mx, my) <= half) hasWater = true
        else navigable[i] = 0
      }
    }
  }

  // Standoff clearance: multi-source BFS in cell units from every BLOCKED cell over navigable cells.
  const clearance = new Int32Array(cols * rows).fill(-1)
  const queue = new Int32Array(cols * rows)
  let qTail = 0
  for (let i = 0; i < navigable.length; i += 1) {
    if (navigable[i] === 0) { clearance[i] = 0; queue[qTail++] = i }
  }
  for (let head = 0; head < qTail; head += 1) {
    if ((head & (DEADLINE_CHECK_CELLS - 1)) === 0 && overDeadline()) return emptyGrid(bbox)
    const i = queue[head]
    const r = Math.floor(i / cols)
    const c = i - r * cols
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc; const nr = r + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      const ni = nr * cols + nc
      if (clearance[ni] !== -1) continue
      clearance[ni] = clearance[i] + 1
      queue[qTail++] = ni
    }
  }

  const desiredCells = standoffMeters > 0 ? standoffMeters / cell : 0
  const stepPenalty = (col: number, row: number): number => {
    if (desiredCells <= 0) return 0
    const cl = clearance[row * cols + col]
    if (cl < 0 || cl >= desiredCells) return 0
    return STANDOFF_WEIGHT * (1 - cl / desiredCells)
  }

  return {
    cols,
    rows,
    isNavigable: (col, row) => col >= 0 && col < cols && row >= 0 && row < rows && navigable[row * cols + col] === 1,
    stepPenalty,
    cellCenter,
    cellOf,
    cellMeters: cell,
    hasWater
  }
}

/**
 * Fill the cells whose CENTER lies inside the polygon (even-odd over all rings) by scanline, calling
 * `onCell(index)` for each. O(rows x edges + filled cells). Returns true if the deadline passed.
 */
function fillPolygonCells (
  rings: number[][][],
  toCol: (lon: number) => number,
  toRow: (lat: number) => number,
  cols: number,
  rows: number,
  onCell: (index: number) => void,
  deadlineMs?: number
): boolean {
  const edges: Array<[number, number, number, number]> = []
  let rMin = rows
  let rMax = -1
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const x0 = toCol(ring[j][0]); const y0 = toRow(ring[j][1])
      const x1 = toCol(ring[i][0]); const y1 = toRow(ring[i][1])
      edges.push([x0, y0, x1, y1])
      rMin = Math.min(rMin, Math.floor(Math.min(y0, y1)))
      rMax = Math.max(rMax, Math.ceil(Math.max(y0, y1)))
    }
  }
  rMin = Math.max(0, rMin)
  rMax = Math.min(rows - 1, rMax)
  for (let row = rMin; row <= rMax; row += 1) {
    if (((row - rMin) & 255) === 0 && deadlineMs !== undefined && Date.now() > deadlineMs) return true
    const y = row + 0.5
    const xs: number[] = []
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 > y) === (y1 > y)) continue
      xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cStart = Math.max(0, Math.ceil(xs[k] - 0.5))
      const cEnd = Math.min(cols - 1, Math.floor(xs[k + 1] - 0.5))
      for (let col = cStart; col <= cEnd; col += 1) onCell(row * cols + col)
    }
  }
  return false
}

/** Planar distance in meters from a point to a polyline, projecting at the given meters-per-degree scales. */
function planarPointToPolylineMeters (p: Position, polyline: Position[], mx: number, my: number): number {
  if (polyline.length === 0) return Infinity
  const px = p.longitude * mx
  const py = p.latitude * my
  if (polyline.length === 1) return Math.hypot(px - polyline[0].longitude * mx, py - polyline[0].latitude * my)
  let best = Infinity
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    const ax = polyline[i].longitude * mx; const ay = polyline[i].latitude * my
    const bx = polyline[i + 1].longitude * mx; const by = polyline[i + 1].latitude * my
    const dx = bx - ax; const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (d < best) best = d
  }
  return best
}
