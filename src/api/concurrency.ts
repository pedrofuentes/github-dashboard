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
 * Results are returned in input order regardless of completion order. An
 * optional {@link AbortSignal} is forwarded to every `fn` call and also halts
 * scheduling: once aborted, no further items are started (in-flight calls are
 * left to settle by `fn` itself).
 *
 * @param items - Inputs to map.
 * @param limit - Maximum concurrent `fn` invocations (clamped to ≥1).
 * @param fn - Async mapper invoked with each item and the shared `signal`.
 * @param signal - Optional signal that forwards to `fn` and stops scheduling.
 * @returns The mapped results, ordered to match `items`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, signal?: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const workerCount = Math.max(1, Math.min(Math.floor(limit), items.length));
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], signal);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}
