/** The grid A* operates over; coordinates are [col, row], origin top-left. */
export interface AStarGrid {
  cols: number
  rows: number
  /** True when [col, row] is in bounds and navigable. */
  isNavigable: (col: number, row: number) => boolean
  /** Non-negative extra cost for stepping into [col, row] (the standoff cost). */
  stepPenalty: (col: number, row: number) => number
}

/** A tiny binary min-heap keyed by a number priority; payload is the cell index. */
class MinHeap {
  private readonly keys: number[] = []
  private readonly vals: number[] = []
  get size (): number { return this.keys.length }
  push (key: number, val: number): void {
    this.keys.push(key)
    this.vals.push(val)
    let i = this.keys.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(i, p)
      i = p
    }
  }

  pop (): number {
    const top = this.vals[0]
    const lastKey = this.keys.pop() as number
    const lastVal = this.vals.pop() as number
    if (this.keys.length > 0) {
      this.keys[0] = lastKey
      this.vals[0] = lastVal
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < this.keys.length && this.keys[l] < this.keys[s]) s = l
        if (r < this.keys.length && this.keys[r] < this.keys[s]) s = r
        if (s === i) break
        this.swap(i, s)
        i = s
      }
    }
    return top
  }

  private swap (a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k
    const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v
  }
}

const SQRT2 = Math.SQRT2
// 8-connectivity offsets and their step distances.
const NEIGHBORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
]

/** Check the wall-clock deadline every this many pops, to bound the synchronous search. */
const DEADLINE_CHECK_INTERVAL = 4096

/**
 * A* over the grid from `start` to `goal` ([col, row]), 8-connected. Step cost is
 * the geometric distance times `1 + stepPenalty(target)`; the Euclidean-distance
 * heuristic stays admissible because the penalty is non-negative, so it never
 * overestimates. Returns the ordered cell path including both endpoints, or
 * `undefined` when the goal is unreachable, when an endpoint is not navigable, or
 * when `deadlineMs` is given and passes mid-search. A diagonal step is disallowed
 * when it would cut between two blocked orthogonal neighbors, so the path never
 * clips a land corner.
 */
export function findPath (
  grid: AStarGrid,
  start: [number, number],
  goal: [number, number],
  deadlineMs?: number
): Array<[number, number]> | undefined {
  const { cols, rows } = grid
  if (!grid.isNavigable(start[0], start[1]) || !grid.isNavigable(goal[0], goal[1])) return undefined
  const idx = (c: number, r: number): number => r * cols + c
  const gScore = new Float64Array(cols * rows).fill(Infinity)
  const cameFrom = new Int32Array(cols * rows).fill(-1)
  const closed = new Uint8Array(cols * rows)
  const goalIdx = idx(goal[0], goal[1])
  const h = (c: number, r: number): number => Math.hypot(c - goal[0], r - goal[1])
  const open = new MinHeap()
  const startIdx = idx(start[0], start[1])
  gScore[startIdx] = 0
  open.push(h(start[0], start[1]), startIdx)
  let pops = 0
  while (open.size > 0) {
    const cur = open.pop()
    if (closed[cur] === 1) continue
    closed[cur] = 1
    if (cur === goalIdx) break
    if ((pops += 1) % DEADLINE_CHECK_INTERVAL === 0 && deadlineMs !== undefined && Date.now() > deadlineMs) {
      return undefined
    }
    const cr = Math.floor(cur / cols)
    const cc = cur - cr * cols
    const baseG = gScore[cur]
    for (const [dc, dr, step] of NEIGHBORS) {
      const nc = cc + dc
      const nr = cr + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      if (!grid.isNavigable(nc, nr)) continue
      if (dc !== 0 && dr !== 0 && (!grid.isNavigable(cc + dc, cr) || !grid.isNavigable(cc, cr + dr))) continue
      const ni = idx(nc, nr)
      if (closed[ni] === 1) continue
      const tentative = baseG + step * (1 + grid.stepPenalty(nc, nr))
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative
        cameFrom[ni] = cur
        open.push(tentative + h(nc, nr), ni)
      }
    }
  }
  if (gScore[goalIdx] === Infinity) return undefined
  const path: Array<[number, number]> = []
  for (let i = goalIdx; i !== -1; i = cameFrom[i]) {
    path.push([i % cols, Math.floor(i / cols)])
  }
  return path.reverse()
}
