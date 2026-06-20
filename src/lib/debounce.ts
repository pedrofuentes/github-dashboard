/**
 * A minimal trailing-edge debounce. The wrapped function runs once, `delayMs`
 * after the last call, with that last call's arguments — collapsing a burst of
 * rapid calls into a single invocation. Used to keep responsive UI state updates
 * immediate while deferring expensive side effects (e.g. a `localStorage` write
 * during a react-grid-layout drag).
 */

/** A debounced function, plus controls to drop or force its pending call. */
export interface DebouncedFunction<A extends readonly unknown[]> {
  (...args: A): void;
  /** Drops any pending invocation without running it. */
  cancel: () => void;
  /** Runs a pending invocation immediately (with the latest args), if any. */
  flush: () => void;
}

/**
 * Wraps `fn` so it only runs once the caller stops invoking it for `delayMs`.
 *
 * @param fn - The function to debounce.
 * @param delayMs - Quiet period, in milliseconds, before `fn` runs.
 */
export function debounce<A extends readonly unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): DebouncedFunction<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: A | undefined;

  const debounced = (...args: A): void => {
    pendingArgs = args;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      const next = pendingArgs;
      pendingArgs = undefined;
      if (next !== undefined) {
        fn(...next);
      }
    }, delayMs);
  };

  debounced.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pendingArgs = undefined;
  };

  debounced.flush = (): void => {
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    const next = pendingArgs;
    pendingArgs = undefined;
    if (next !== undefined) {
      fn(...next);
    }
  };

  return debounced;
}
