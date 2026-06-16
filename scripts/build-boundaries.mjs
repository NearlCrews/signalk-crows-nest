// Build the bundled country-boundary asset for border-aware route drafting.
//
// Source: Natural Earth admin-0 countries, 1:10m, the file `ne_10m_admin_0_countries` (the DEFAULT,
// which INCLUDES boundary lakes as country geometry). Do NOT use the `..._lakes` variant: it erases
// the Great Lakes water this feature depends on. Natural Earth is public domain (no attribution).
//   Download, for example:
//   curl -sL -o /tmp/ne.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//
// Run from the repo root:
//   node scripts/build-boundaries.mjs /tmp/ne.geojson
//
// It strips each feature to { id, name } and simplifies with a zero-dependency, variable-tolerance
// Douglas-Peucker: fine over the narrow US/Canada connecting rivers (so the boundary stays mid-channel)
// and coarse elsewhere (a small worldwide bundle; a coarse coastline only ever turns the constraint
// off, which is safe). No packages, so the build pulls in nothing unmaintained.
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2]
const OUT = 'assets/boundaries/countries.geojson'
if (!SRC) {
  console.error('usage: node scripts/build-boundaries.mjs <ne_10m_admin_0_countries.geojson>')
  process.exit(1)
}

// The narrow connecting rivers where the boundary must stay mid-channel. The open lakes are tens of
// km wide, so a coarse mid-lake boundary is harmless; only these tight corridors need fidelity.
const FINE = [
  { west: -83.7, south: 41.9, east: -82.3, north: 43.1 }, // Detroit River, Lake St. Clair, St. Clair River
  { west: -84.6, south: 46.0, east: -83.9, north: 46.6 }, // St. Marys River (Sault Ste. Marie)
  { west: -79.2, south: 42.8, east: -78.8, north: 43.4 }, // Niagara River
  { west: -76.6, south: 43.9, east: -74.2, north: 45.2 }, // St. Lawrence (Thousand Islands)
]
const FINE_EPS = 0.0003 // ~33 m, below the 60 m grid cell, so the river boundary stays mid-channel
const COARSE_EPS = 0.04 // ~4 km; coarse coastlines and open-lake boundaries are never blocked tightly
const MIN_RING_DEG = 0.06 // drop a far-flung island smaller than this unless it touches a fine corridor

const inFine = (lon, lat) =>
  FINE.some((b) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north)
const epsAt = (p) => (inFine(p[0], p[1]) ? FINE_EPS : COARSE_EPS)

function simplifyRing (points) {
  const n = points.length
  if (n < 5) return points
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length > 0) {
    const [s, e] = stack.pop()
    const ax = points[s][0]
    const ay = points[s][1]
    const dx = points[e][0] - ax
    const dy = points[e][1] - ay
    const len2 = dx * dx + dy * dy
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i += 1) {
      const px = points[i][0]
      const py = points[i][1]
      let d
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay)
      } else {
        const t = ((px - ax) * dx + (py - ay) * dy) / len2
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      }
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > epsAt(points[idx])) {
      keep[idx] = 1
      stack.push([s, idx])
      stack.push([idx, e])
    }
  }
  const out = []
  for (let i = 0; i < n; i += 1) if (keep[i] === 1) out.push(points[i])
  return out
}

const r = (n) => Math.round(n * 1e5) / 1e5
function roundDedup (ring) {
  const out = []
  let px = NaN
  let py = NaN
  for (const [lon, lat] of ring) {
    const x = r(lon)
    const y = r(lat)
    if (x === px && y === py) continue
    out.push([x, y])
    px = x
    py = y
  }
  if (out.length >= 2 && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) {
    out.push([out[0][0], out[0][1]])
  }
  return out
}

function ringTouchesFine (ring) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  const span = Math.max(east - west, north - south)
  const touches = inFine((west + east) / 2, (south + north) / 2) || ring.some(([lo, la]) => inFine(lo, la))
  return { span, touches }
}

function processRing (ring) {
  const { span, touches } = ringTouchesFine(ring)
  if (span < MIN_RING_DEG && !touches) return null
  const rd = roundDedup(simplifyRing(ring))
  return rd.length >= 4 ? rd : null
}

function processGeom (g) {
  if (g.type === 'Polygon') {
    const rings = g.coordinates.map(processRing).filter(Boolean)
    return rings.length ? { type: 'Polygon', coordinates: rings } : null
  }
  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates
      .map((poly) => poly.map(processRing).filter(Boolean))
      .filter((poly) => poly.length >= 1)
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }
  return null
}

const fc = JSON.parse(readFileSync(SRC, 'utf8'))
const features = []
for (const f of fc.features) {
  const geom = processGeom(f.geometry)
  if (!geom) continue
  const id = f.properties.ADM0_A3 ?? f.properties.SOV_A3 ?? f.properties.NAME
  const name = f.properties.NAME ?? f.properties.ADMIN ?? id
  features.push({ type: 'Feature', properties: { id, name }, geometry: geom })
}
const text = JSON.stringify({ type: 'FeatureCollection', features })
writeFileSync(OUT, text)
console.log(`wrote ${OUT}: ${features.length} features, ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB`)
