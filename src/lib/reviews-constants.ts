/**
 * Shared primitives for the "reviews" signal (issue #15).
 *
 * The score weight, the pagination page cap, and the cross-repo Search query
 * live here so both the REST hook (`useReviewsSignal`) and the batched GraphQL
 * deriver (`reviewsDeriver` in `api/github/fleet-query`) agree on the exact same
 * values without duplicating them — and without the
 * hook→api/github→fleet-query→hook import cycle that a direct reuse would create
 * (mirroring `lib/stale-cutoff` for the stale signal).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/** Awaiting *your* review is high urgency: weight the score accordingly. */
export const REVIEW_SCORE_WEIGHT = 10;

/** Cross-repo Search query for open PRs requesting the viewer's review. */
export const REVIEW_REQUESTED_QUERY = 'is:open is:pr review-requested:@me';

/**
 * Cap on pages of requested reviews accumulated for the inbox list. At 100
 * results per page this lists up to 1,000 review requests — far beyond any
 * realistic review queue — while guaranteeing pagination can never loop
 * indefinitely. The REST hook follows `Link: rel="next"`; the GraphQL deriver
 * follows `pageInfo.hasNextPage`/`endCursor`. Both stop at this cap.
 */
export const MAX_REVIEW_PAGES = 10;
