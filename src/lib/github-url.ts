/**
 * GitHub URL origin guard.
 *
 * Privacy/security invariant (mirrors the avatar allowlist in
 * `validate-token.ts` and the CI deep-link check): the UI must never render a
 * link to, or fetch from, a non-GitHub origin. Any `html_url`-style value that
 * reaches the DOM as an `href` is validated here first, so a tampered or
 * unexpected API response can't turn into an off-origin navigation.
 */

/**
 * True only for an absolute `https:` URL whose host is exactly `github.com` or
 * a sub-domain of it (e.g. `gist.github.com`), with no embedded userinfo.
 *
 * Everything else — `http`/`data`/`javascript`/`blob` schemes,
 * protocol-relative `//host`, `user@host` userinfo, suffix-confusion
 * (`github.com.evil.com`), lookalikes (`notgithub.com`), or unparseable
 * values — is rejected.
 */
export function isGitHubUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return host === 'github.com' || host.endsWith('.github.com');
}

/**
 * Returns `url` unchanged when it is a safe GitHub link (see {@link isGitHubUrl}),
 * otherwise `undefined`. Render the result as an `href` only when it is defined,
 * so unsafe or missing values degrade to plain text instead of a live link.
 */
export function safeGitHubHref(url: string | null | undefined): string | undefined {
  return typeof url === 'string' && isGitHubUrl(url) ? url : undefined;
}
