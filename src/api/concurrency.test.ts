import { describe, expect, it, vi } from 'vitest';

import { mapWithConcurrency, SIGNAL_FETCH_CONCURRENCY } from './concurrency';

/** Flushes pending microtasks via a macrotask boundary (no fake timers here). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('SIGNAL_FETCH_CONCURRENCY', () => {
  it('is a small, bounded positive integer (cold-start fan-out cap)', () => {
    expect(Number.isInteger(SIGNAL_FETCH_CONCURRENCY)).toBe(true);
    expect(SIGNAL_FETCH_CONCURRENCY).toBeGreaterThanOrEqual(1);
    // Issue #60 caps cold-start fan-out at 4-6 in flight. Assert the tight bound
    // (not a loose <=10) so a regression that re-bursts GitHub's secondary rate
    // limits by bumping the cap fails here (#72).
    expect(SIGNAL_FETCH_CONCURRENCY).toBeGreaterThanOrEqual(4);
    expect(SIGNAL_FETCH_CONCURRENCY).toBeLessThanOrEqual(6);
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` tasks at once and saturates the pool', async () => {
    const limit = 4;
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    const fn = (item: number): Promise<number> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<number>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(item * 10);
        });
      });
    };

    const promise = mapWithConcurrency(items, limit, fn);

    await tick();
    // Exactly `limit` tasks started — not all 12. Removing the cap makes this 12.
    expect(peak).toBe(limit);
    expect(release).toHaveLength(limit);

    while (release.length > 0) {
      release.shift()?.();
      await tick();
      expect(inFlight).toBeLessThanOrEqual(limit);
    }

    const results = await promise;
    expect(results).toEqual(items.map((i) => i * 10));
    expect(peak).toBe(limit);
  });

  it('returns results in input order regardless of completion order', async () => {
    const resolvers = new Map<number, (value: number) => void>();
    const fn = (item: number): Promise<number> =>
      new Promise<number>((resolve) => resolvers.set(item, resolve));

    const promise = mapWithConcurrency([0, 1, 2], 3, fn);
    await tick();

    resolvers.get(2)?.(20);
    resolvers.get(0)?.(0);
    resolvers.get(1)?.(10);

    expect(await promise).toEqual([0, 10, 20]);
  });

  it('runs at most `items.length` tasks when fewer items than the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const fn = (item: number): Promise<number> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<number>((resolve) =>
        release.push(() => {
          inFlight -= 1;
          resolve(item);
        }),
      );
    };

    const promise = mapWithConcurrency([1, 2], 6, fn);
    await tick();
    expect(peak).toBe(2);
    release.forEach((r) => r());
    await promise;
  });

  it('returns an empty array and never invokes fn for empty input', async () => {
    const fn = vi.fn();
    expect(await mapWithConcurrency([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('forwards the abort signal to the mapper', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    await mapWithConcurrency(
      [1],
      1,
      async (_item, signal) => {
        received = signal;
        return 1;
      },
      controller.signal,
    );
    expect(received).toBe(controller.signal);
  });

  it('schedules nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started: number[] = [];
    await mapWithConcurrency(
      [0, 1, 2, 3],
      2,
      async (item) => {
        started.push(item);
        return item;
      },
      controller.signal,
    );
    // The abort guard must stop the pool before any task starts.
    expect(started).toEqual([]);
  });

  it('halts further scheduling when aborted mid-flight', async () => {
    const controller = new AbortController();
    const items = Array.from({ length: 8 }, (_, i) => i);
    const started: number[] = [];
    const release: Array<() => void> = [];
    const fn = (item: number): Promise<number> => {
      started.push(item);
      return new Promise<number>((resolve) => release.push(() => resolve(item)));
    };

    const promise = mapWithConcurrency(items, 2, fn, controller.signal);
    await tick();
    expect(started).toEqual([0, 1]);

    controller.abort();
    release.forEach((r) => r());
    await promise;
    await tick();

    // No new tasks scheduled after the abort — removing the guard grows this list.
    expect(started).toEqual([0, 1]);
  });

  it('returns only the settled results densely (no holes) when aborted mid-flight', async () => {
    const controller = new AbortController();
    const items = Array.from({ length: 6 }, (_, i) => i);
    const release: Array<() => void> = [];
    const fn = (item: number): Promise<number> =>
      new Promise<number>((resolve) => release.push(() => resolve(item * 10)));

    const promise = mapWithConcurrency(items, 2, fn, controller.signal);
    await tick();

    // Items 0 and 1 are in flight; aborting before they settle stops the pool
    // from scheduling items 2..5 once the in-flight pair resolves.
    controller.abort();
    release.forEach((r) => r());
    const results = await promise;

    // Only the two completed results are returned, in input order, with NO holes
    // for the never-scheduled items. The old behavior returned a length-6 sparse
    // array padded with holes; both assertions below reject that.
    expect(results).toEqual([0, 10]);
    expect(results).toHaveLength(2);
    expect(Object.keys(results)).toEqual(['0', '1']);
  });
});
