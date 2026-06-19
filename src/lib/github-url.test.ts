import { describe, expect, it } from 'vitest';

import { isGitHubUrl, safeGitHubHref } from './github-url';

describe('isGitHubUrl', () => {
  it('accepts an https://github.com URL', () => {
    expect(isGitHubUrl('https://github.com/octo/repo')).toBe(true);
  });

  it('accepts an https github.com sub-domain (e.g. gist)', () => {
    expect(isGitHubUrl('https://gist.github.com/octo/abc')).toBe(true);
  });

  it.each<[string, string]>([
    ['a non-https scheme', 'http://github.com/octo/repo'],
    ['a non-GitHub origin', 'https://evil.example.com/octo/repo'],
    ['a suffix-confusion host', 'https://github.com.evil.com/x'],
    ['a lookalike host', 'https://notgithub.com/x'],
    ['embedded userinfo', 'https://user@github.com/x'],
    ['userinfo with a password', 'https://user:pass@github.com/x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,phishing'],
    ['a protocol-relative URL', '//github.com/x'],
    ['a malformed URL', 'not a url'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isGitHubUrl(url)).toBe(false);
  });
});

describe('safeGitHubHref', () => {
  it('returns the URL unchanged when it is a GitHub https URL', () => {
    expect(safeGitHubHref('https://github.com/octo/repo')).toBe('https://github.com/octo/repo');
  });

  it('returns undefined for a non-GitHub origin', () => {
    expect(safeGitHubHref('https://evil.example.com/x')).toBeUndefined();
  });

  it('returns undefined for an http (non-https) GitHub URL', () => {
    expect(safeGitHubHref('http://github.com/octo/repo')).toBeUndefined();
  });

  it('returns undefined for undefined, null or empty input', () => {
    expect(safeGitHubHref(undefined)).toBeUndefined();
    expect(safeGitHubHref(null)).toBeUndefined();
    expect(safeGitHubHref('')).toBeUndefined();
  });
});
