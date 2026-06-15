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
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1e-9
  let far = 0
  let farIdx = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i]
    const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
    if (dist > far) {
      far = dist
      farIdx = i
    }
  }
  if (far <= epsilon) return [[ax, ay], [bx, by]]
  const left = simplifyPath(points.slice(0, farIdx + 1), epsilon)
  const right = simplifyPath(points.slice(farIdx), epsilon)
  return [...left.slice(0, -1), ...right]
}
