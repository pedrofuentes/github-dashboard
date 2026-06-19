/**
 * Tiny dependency-free concurrency limiter for per-repo fan-out.
 *
 * The signal hooks fetch one (or more) endpoint per repository. On a large
 * fleet, firing every request at once bursts GitHub's secondary rate limits and
 * floods the browser's connection pool on cold start. {@link mapWithConcurrency}
 * runs a bounded worker pool so at most `limit` requests are ever in flight,
 * while still saturating the pool for throughput.
 */

/**
 * Maximum number of concurrent per-repo fetches across a single signal hook run.
 *
 * Six keeps cold-start fan-out well under GitHub's secondary rate limits while
 * still overlapping enough requests to stay responsive on large fleets. Chosen
 * per issue #60's 4–6 guidance; tune here if limits change.
 */
export const SIGNAL_FETCH_CONCURRENCY = 6;

/**
 * Maps `items` through `fn` with at most `limit` concurrent invocations.
 *
 * Completion contract: the returned array holds the results of the calls that
 * **actually settled**, in input order. On a normal run every item completes, so
 * the result is positionally aligned with `items` (`result[i]` ⇄ `items[i]`).
 * When an {@link AbortSignal} halts the pool mid-flight, items that were never
 * scheduled are simply absent — the result is a **dense** array of only the
 * settled values (no sparse holes), so callers can iterate it without `in`/
 * hole checks. Because the result is compacted on abort, indices are not a
 * reliable map back to `items` in that case; callers that need the pairing
 * should capture it inside `fn` (today every caller discards the array and lets
 * each `fn` record its own result).
 *
 * An optional {@link AbortSignal} is forwarded to every `fn` call and also halts
 * scheduling: once aborted, no further items are started (in-flight calls are
 * left to settle by `fn` itself, and their values are included).
 *
 * @param items - Inputs to map.
 * @param limit - Maximum concurrent `fn` invocations (clamped to ≥1).
 * @param fn - Async mapper invoked with each item and the shared `signal`.
 * @param signal - Optional signal that forwards to `fn` and stops scheduling.
 * @returns The settled results in input order (dense; only completed items).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, signal?: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return [];

  const workerCount = Math.max(1, Math.min(Math.floor(limit), items.length));
  let cursor = 0;
  // Record (index, value) per settled call so the result can be returned in
  // input order while staying dense when an abort skips trailing items.
  const settled: Array<{ index: number; value: R }> = [];

  const runWorker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      const value = await fn(items[index], signal);
      settled.push({ index, value });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));

  settled.sort((a, b) => a.index - b.index);
  return settled.map((entry) => entry.value);
}
