/**
 * Bounded-concurrency fan-out shared across the plugin.
 *
 * Several places need to run an async operation over a list with a small worker
 * pool — overlapping independent work without flooding a single upstream — and
 * had each hand-rolled the same shared-cursor pool (a `next` counter drained by
 * `Math.min(limit, n)` workers). This is that pool, once.
 */

/**
 * Run `fn` over every item with at most `limit` in flight at a time, returning
 * the results in input order. A shared cursor feeds the workers, so each item is
 * processed exactly once and a slow item does not stall the others. `fn` must
 * handle its own per-item errors: an `fn` that rejects rejects the whole pool
 * (matching `Promise.all`).
 *
 * @param items - The work list.
 * @param limit - Maximum number of concurrent `fn` calls (clamped to at least 1,
 *   and never more than `items.length`).
 * @param fn - The async operation, given the item and its index.
 * @returns The results in the same order as `items` (empty when `items` is).
 */
export async function mapWithConcurrency<T, R> (
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker (): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}
