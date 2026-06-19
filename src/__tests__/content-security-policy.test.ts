/**
 * Source-of-truth guard for the app shell's Content-Security-Policy.
 *
 * The deployed dashboard is a client-only SPA whose single hard privacy
 * guarantee is that the user's PAT and data never leave the browser except to
 * GitHub's own origins (DoD #19, AGENTS.md §Boundaries). A restrictive CSP is
 * the defense-in-depth half of that guarantee: even if a script were injected,
 * `connect-src` keeps it from exfiltrating data to a non-GitHub origin.
 *
 * This test pins the policy declared in `index.html` so the lock can never be
 * silently loosened. The companion `e2e/privacy.spec.ts` proves the *runtime*
 * behaviour (only GitHub origins are actually contacted).
 *
 * Header-delivered hardening — a real `Content-Security-Policy` *response header*
 * (so `frame-ancestors 'none'` applies), an `X-Frame-Options: DENY` header, and
 * path-scoping `connect-src` to `github.com/login/*` — is a hosting-layer
 * follow-up, not achievable here: GitHub Pages serves no custom response
 * headers, so those are deferred to a header-capable host/proxy rather than
 * weakening this `<meta>` policy (#81, #36, #44). This guard therefore pins only
 * what the `<meta>` tag can carry, and rejects duplicate directives (which
 * browsers resolve first-wins) so a second, looser copy can't slip through.
 *
 * It also pins the *absence* of `frame-ancestors`: browsers ignore that
 * directive in a `<meta>` element and log a console error on every load, so it
 * provides zero clickjacking protection here and only adds noise. Asserting it
 * is gone keeps the live console clean (a v1 DoD AC) and stops the inert,
 * console-noisy directive from being reintroduced — frame protection belongs to
 * the header-delivery follow-up above (#81).
 */
import { describe, expect, it } from 'vitest';

import INDEX_HTML from '../../index.html?raw';

/** The exact set of origins the app is ever allowed to open a connection to. */
const EXPECTED_CONNECT_SRC = [
  "'self'",
  'https://api.github.com',
  'https://github.com',
  'https://*.githubusercontent.com',
];

/** Splits a CSP policy string into a `directive -> sources[]` map. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const segment of policy.split(';')) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0];
    if (name === undefined) {
      continue;
    }
    const directive = name.toLowerCase();
    if (directives.has(directive)) {
      // Browsers honour the FIRST occurrence of a duplicated directive and
      // ignore the rest; a last-wins parse (Map overwrite) would mask a second,
      // looser copy. Reject duplicates so the pin reflects what the browser
      // actually enforces.
      throw new Error(`Duplicate CSP directive: ${directive}`);
    }
    directives.set(directive, tokens.slice(1));
  }
  return directives;
}

function cspMetaTag(html: string): string | null {
  const match = html.match(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  return match ? match[0] : null;
}

function cspContent(html: string): string | null {
  const tag = cspMetaTag(html);
  if (tag === null) {
    return null;
  }
  const content = tag.match(/content=(["'])([\s\S]*?)\1/i);
  return content ? content[2] : null;
}

describe('index.html Content-Security-Policy', () => {
  it('ships a Content-Security-Policy meta tag', () => {
    expect(cspMetaTag(INDEX_HTML)).not.toBeNull();
  });

  it('locks connect-src to the GitHub allowlist only (no wildcard)', () => {
    const content = cspContent(INDEX_HTML);
    expect(content).not.toBeNull();

    const connectSrc = parsePolicy(content ?? '').get('connect-src');
    expect(connectSrc).toBeDefined();
    expect([...(connectSrc ?? [])].sort()).toEqual([...EXPECTED_CONNECT_SRC].sort());
    expect(connectSrc).not.toContain('*');
  });

  it('applies a restrictive default-src, object-src and base-uri', () => {
    const directives = parsePolicy(cspContent(INDEX_HTML) ?? '');
    expect(directives.get('default-src')).toContain("'self'");
    expect(directives.get('object-src')).toContain("'none'");
    expect(directives.get('base-uri')).toContain("'self'");
  });

  it('omits frame-ancestors (ignored in <meta>; header-only, tracked as a follow-up)', () => {
    // `frame-ancestors` has effect ONLY as an HTTP response header; browsers
    // ignore it in a <meta http-equiv=Content-Security-Policy> and emit a
    // console error on every load. GitHub Pages cannot send custom headers, so
    // the directive bought zero protection and only added console noise. Pin its
    // absence so it can't be reintroduced; header-delivered frame protection is
    // tracked as a hosting-layer follow-up (#81). Every other directive — the
    // GitHub-locked connect-src, default-src 'self', object-src 'none',
    // base-uri 'self' — stays asserted by the tests above.
    const directives = parsePolicy(cspContent(INDEX_HTML) ?? '');
    expect(directives.has('frame-ancestors')).toBe(false);
  });

  it('declares each directive at most once (no duplicate the parser must resolve)', () => {
    expect(() => parsePolicy(cspContent(INDEX_HTML) ?? '')).not.toThrow();
  });
});

describe('parsePolicy duplicate-directive guard', () => {
  it('rejects a policy that declares the same directive more than once', () => {
    // Browsers honour the FIRST occurrence and ignore the rest, so a last-wins
    // parse would silently mask a second, looser `connect-src *`. Reject it.
    expect(() =>
      parsePolicy("default-src 'self'; connect-src https://api.github.com; connect-src *"),
    ).toThrow(/duplicate csp directive: connect-src/i);
  });

  it('still parses a single occurrence of each directive', () => {
    const directives = parsePolicy("default-src 'self'; connect-src https://api.github.com");
    expect(directives.get('connect-src')).toEqual(['https://api.github.com']);
  });
});
