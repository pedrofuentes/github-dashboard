/**
 * Abort-detection helper shared by the fetch layer and the signal hooks.
 *
 * `fetch()` rejects an aborted request with a `DOMException` named
 * `AbortError`, but some environments/polyfills surface a plain `Error` (or a
 * bare object) with the same `name`. Matching on `name` rather than `instanceof`
 * keeps cancellation handling robust across all of them.
 */

/** True when `error` represents an aborted operation (name === 'AbortError'). */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
