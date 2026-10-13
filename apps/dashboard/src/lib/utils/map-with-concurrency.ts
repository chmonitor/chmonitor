/**
 * Run `fn` over `items` with at most `concurrency` calls in flight, returning
 * results in input order. `fn` must handle its own errors: a rejection from
 * `fn` rejects the whole batch (callers isolate per-item failures themselves).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}
