/**
 * Per-signal GitHub deep links for the Deck/Boards tiles.
 *
 * Each visible tile is one `(repo, signal)` pairing, so a tile press can jump
 * straight to the matching GitHub web page (the Actions tab for CI, the issues
 * list for Issues, …) instead of opening the in-app drill-down. This module is
 * the single source of truth for that mapping: pure, no DOM, no I/O.
 *
 * Security invariant: every URL it returns is passed through {@link safeGitHubHref}
 * (the same origin guard the drill-down drawer uses), so a tampered CI
 * `latestRunUrl` can never become an off-origin navigation — it falls back to the
 * repo's own Actions tab instead. For the static section links the result is
 * always defined; render the result as an `href` only when it is defined.
 */
import type { TileSignalType } from '../types/dashboard';
import type { Repo, RepoSignalData } from '../types/fleet';
import { safeGitHubHref } from './github-url';

/**
 * The GitHub web URL a tile for `signal` should open for `repo`.
 *
 * CI prefers the latest run's deep link when the slice carries a safe one
 * (jumping to the run that's most likely failing), otherwise the repo's Actions
 * tab. Reviews and Stale carry a focused search query (review-requested PRs;
 * oldest-updated open issues); every other signal targets its repo section.
 * Activity (Boards only — the Deck excludes it) targets the commit history.
 *
 * Returns `undefined` only if the constructed link somehow fails the GitHub
 * origin guard, which cannot happen for the static section links built from
 * `repo.nameWithOwner`.
 */
export function signalDeepLinkUrl(
  repo: Repo,
  signal: TileSignalType,
  data: RepoSignalData,
): string | undefined {
  const base = `https://github.com/${repo.nameWithOwner}`;

  switch (signal) {
    case 'ci':
      return safeGitHubHref(data.ci?.latestRunUrl) ?? safeGitHubHref(`${base}/actions`);
    case 'security':
      return safeGitHubHref(`${base}/security`);
    case 'reviews':
      return safeGitHubHref(`${base}/pulls?q=is%3Aopen+is%3Apr+review-requested%3A%40me`);
    case 'pullRequests':
      return safeGitHubHref(`${base}/pulls`);
    case 'issues':
      return safeGitHubHref(`${base}/issues`);
    case 'stale':
      return safeGitHubHref(`${base}/issues?q=is%3Aopen+sort%3Aupdated-asc`);
    case 'activity':
      return safeGitHubHref(`${base}/commits`);
  }
}
