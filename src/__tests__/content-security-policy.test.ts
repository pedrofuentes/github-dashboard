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
    directives.set(name.toLowerCase(), tokens.slice(1));
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
});
