import type { ReactElement } from 'react';

import { GITHUB_STATUS_URL } from '../lib/github-status';

/**
 * A small, clickable pointer to GitHub's status page, shown beneath an
 * outage-shaped error (connectivity, timeout, auth, access denied, server) so a
 * GitHub-side incident is not misread as a user problem.
 *
 * Inherits the surrounding alert's text color (`currentColor`) so it reads
 * correctly inside both the sign-in alert and the failure-colored load-error
 * banners. Uses the app's safe external-link pattern
 * (`target="_blank" rel="noreferrer noopener"`).
 */
export function GitHubStatusHint(): ReactElement {
  return (
    <p className="mt-2 text-sm">
      GitHub may be having an incident —{' '}
      <a
        href={GITHUB_STATUS_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-fit items-center gap-1 rounded font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        check GitHub Status <span aria-hidden="true">↗</span>
      </a>
    </p>
  );
}
