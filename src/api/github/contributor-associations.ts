/**
 * Shared new-outside-contributor predicate for the "pull requests" signal
 * (issue #15).
 *
 * The set of `author_association` values that mark a *new* outside contributor
 * lives here so both the REST hook (`usePullRequestsSignal`) and the batched
 * GraphQL deriver (`prDeriver` in `api/github/fleet-query`) classify PR authors
 * identically — the new-contributor predicate can never drift between the two
 * paths. This module imports nothing, so reusing it introduces no import cycle.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * `author_association` values GitHub assigns to a PR author who is NOT a member,
 * owner, or collaborator — i.e. a *new* outside contributor. `CONTRIBUTOR`
 * (a returning external contributor) is deliberately excluded: this signal
 * highlights brand-new arrivals that most warrant a maintainer's attention.
 */
export const OUTSIDE_CONTRIBUTOR_ASSOCIATIONS = new Set([
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'NONE',
  'MANNEQUIN',
]);
