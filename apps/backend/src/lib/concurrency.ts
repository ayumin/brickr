/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Never rejects: each result is reported individually so one character's
 * failure cannot abort the others (CLAUDE.md §51).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ item: T; value: R } | { item: T; error: unknown }>> {
  const results: Array<{ item: T; value: R } | { item: T; error: unknown }> = [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;

  async function pump(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      const item = items[index] as T;
      try {
        results[index] = { item, value: await worker(item, index) };
      } catch (error) {
        results[index] = { item, error };
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => pump()));
  return results;
}
