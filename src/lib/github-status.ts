/**
 * GitHub's public status page.
 *
 * Surfaced next to outage-shaped errors (connectivity, timeout, auth, access
 * denied, server) so a GitHub-side incident is not misread as a user problem —
 * a valid token can appear "not working" and the API can appear unreachable
 * during a real GitHub outage.
 *
 * Kept dependency-free (no `src/api/**` import) so the ADR-004-isolated
 * `validate-token.ts` can reference it without pulling in the integration layer.
 */
export const GITHUB_STATUS_URL = 'https://www.githubstatus.com/';
