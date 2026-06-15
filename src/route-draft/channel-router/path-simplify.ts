/**
 * Ramer-Douglas-Peucker reduction of a dense polyline to its turning points.
 * Points are [x, y] in any planar units (grid cells here); epsilon is the max
 * allowed perpendicular deviation in the same units. The endpoints are always
 * kept. Used to turn an A* centerline into a small set of route waypoints.
 */
export function simplifyPath (
  points: ReadonlyArray<[number, number]>,
  epsilon: number
): Array<[number, number]> {
  if (points.length < 3) return points.map((p) => [p[0], p[1]])
  // Recurse over index bounds rather than array slices: each split keeps its lo endpoint, the final
  // hi endpoint is appended once, so no intermediate sub-arrays are allocated per recursion level.
  const out: Array<[number, number]> = []
  const recurse = (lo: number, hi: number): void => {
    const [ax, ay] = points[lo]
    const [bx, by] = points[hi]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-9
    let far = 0
    let farIdx = -1
    for (let i = lo + 1; i < hi; i += 1) {
      const [px, py] = points[i]
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      if (dist > far) {
        far = dist
        farIdx = i
      }
    }
    if (far > epsilon && farIdx !== -1) {
      recurse(lo, farIdx)
      recurse(farIdx, hi)
    } else {
      out.push([ax, ay])
    }
  }
  recurse(0, points.length - 1)
  out.push([points[points.length - 1][0], points[points.length - 1][1]])
  return out
}
