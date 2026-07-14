/**
 * Bounded-concurrency fan-out shared across the plugin.
 *
 * Several places need to run an async operation over a list with a small worker
 * pool to overlap independent work without flooding a single upstream. Each
 * call site had hand-rolled the same shared-cursor pool (a `next` counter
 * drained by `Math.min(limit, n)` workers). This is that pool, once.
 */

/**
 * Run `fn` over every item with at most `limit` in flight at a time, returning
 * the results in input order. A shared cursor feeds the workers, so each item is
 * processed exactly once and a slow item does not stall the others. `fn` must
 * handle its own per-item errors: an `fn` that rejects rejects the whole pool
 * (matching `Promise.all`).
 *
 * @param items - The work list.
 * @param limit - Positive integer maximum for concurrent `fn` calls.
 * @param fn - The async operation, given the item and its index.
 * @returns The results in the same order as `items` (empty when `items` is).
 */
export async function mapWithConcurrency<T, R> (
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('mapWithConcurrency: limit must be a positive integer')
  }
  const results = new Array<R>(items.length)
  let next = 0
  async function worker (): Promise<void> {
    while (next < items.length) {
      if (signal?.aborted === true) {
        throw signal.reason
      }
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}
