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
  const n = points.length
  if (n < 3) return points.map((p) => [p[0], p[1]])
  // Iterative Douglas-Peucker over an explicit stack of index ranges, marking the points to keep, so a
  // long winding path (the A* centerline can run to thousands of cells) cannot overflow the call stack
  // the way recursion would. The kept set is the two endpoints plus every split point (the farthest
  // interior point beyond epsilon from its chord), collected in index order: identical to the recursion.
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number]
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
      keep[farIdx] = 1
      stack.push([lo, farIdx])
      stack.push([farIdx, hi])
    }
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i += 1) if (keep[i] === 1) out.push([points[i][0], points[i][1]])
  return out
}
