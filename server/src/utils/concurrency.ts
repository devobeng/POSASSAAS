/** Runs `fn` over `items` with at most `limit` in flight at once, preserving
 *  input order in the returned results. Used anywhere a loop would otherwise
 *  await an external call (Paystack, another order's transaction) one at a
 *  time and risk a request/job timing out on a large batch. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
