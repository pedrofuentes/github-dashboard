/**
 * Shared stale-window primitives for the "stale" signal (issue #17).
 *
 * The inactivity threshold, the per-repo item cap, and the UTC cutoff-date
 * helper live here so both the REST hook (`useStaleSignal`) and the batched
 * GraphQL deriver (`staleDeriver` in `api/github/fleet-query`) compute the exact
 * same Search query without duplicating the cutoff logic — and without the
 * hook→api/github→fleet-query→hook import cycle that a direct reuse would create.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Days of inactivity after which an open PR or issue counts as stale. A single
 * tunable applied to both PRs and issues so one Search query covers a repo.
 */
export const STALE_THRESHOLD_DAYS = 30;

/**
 * Items requested from a single per-repo stale Search call. The page is bounded
 * (still one call per repo) and read newest-stale-first so each stale item's
 * identity is available without an extra request; the total tally drives the
 * count regardless of this cap.
 */
export const STALE_ITEMS_PER_REPO = 30;

/**
 * The inactivity cutoff as a UTC `YYYY-MM-DD` date: open items not updated on
 * or after this day are stale. Computed in UTC so the query is deterministic
 * regardless of the viewer's local time zone.
 */
export function staleCutoffDate(now: Date, days: number = STALE_THRESHOLD_DAYS): string {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}
