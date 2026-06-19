import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateToken } from './validate-token';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateToken', () => {
  it('calls GET https://api.github.com/user with the documented headers', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' }),
    );

    await validateToken('ghp_secret');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_secret');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('returns ok with login + avatarUrl on a 200 response', async () => {
    stubFetch(async () =>
      jsonResponse({ login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' }),
    );

    const result = await validateToken('ghp_valid');

    expect(result).toEqual({
      ok: true,
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    });
  });

  it('maps a 401 to "Invalid or expired token"', async () => {
    stubFetch(async () => new Response('', { status: 401 }));

    const result = await validateToken('ghp_bad');

    expect(result).toEqual({ ok: false, error: 'Invalid or expired token' });
  });

  it('maps other non-ok statuses to a friendly, retryable error', async () => {
    stubFetch(async () => new Response('', { status: 500 }));

    const result = await validateToken('ghp_x');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/try again/i);
    }
  });

  it('maps a network failure to a friendly error', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await validateToken('ghp_x');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/network|connection/i);
    }
  });

  it('treats a 200 with a malformed body as an error', async () => {
    stubFetch(async () => new Response('{ not json', { status: 200 }));

    const result = await validateToken('ghp_x');

    expect(result.ok).toBe(false);
  });

  it('treats a 200 missing login/avatar as an error', async () => {
    stubFetch(async () => jsonResponse({ unexpected: true }));

    const result = await validateToken('ghp_x');

    expect(result.ok).toBe(false);
  });

  it('only ever contacts api.github.com (privacy invariant)', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ login: 'o', avatar_url: 'https://avatars.githubusercontent.com/u/1' }),
    );

    await validateToken('ghp_x');

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toMatch(/^https:\/\/api\.github\.com\//);
    }
  });

  it('never writes the token to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    stubFetch(async () => {
      throw new Error('boom');
    });

    await validateToken('ghp_super_secret_value');

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('ghp_super_secret_value');
      }
    }
  });

  describe('avatar URL host-allowlist (ADR-004)', () => {
    it('accepts a valid https *.githubusercontent.com avatar', async () => {
      stubFetch(async () =>
        jsonResponse({
          login: 'octocat',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        }),
      );

      const result = await validateToken('ghp_x');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.login).toBe('octocat');
        expect(result.avatarUrl).toBe('https://avatars.githubusercontent.com/u/1?v=4');
      }
    });

    it('accepts the apex githubusercontent.com host (case-insensitively)', async () => {
      stubFetch(async () =>
        jsonResponse({ login: 'octocat', avatar_url: 'https://GitHubUserContent.com/u/1' }),
      );

      const result = await validateToken('ghp_x');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.avatarUrl).toBe('https://GitHubUserContent.com/u/1');
      }
    });

    it.each([
      ['a non-https scheme', 'http://avatars.githubusercontent.com/u/1'],
      ['a non-GitHub host', 'https://evil.com/u/1'],
      ['a suffix-confusion host', 'https://githubusercontent.com.evil.com/u/1'],
      ['a lookalike host', 'https://evilgithubusercontent.com/u/1'],
      ['embedded userinfo', 'https://user@githubusercontent.com/u/1'],
      ['userinfo with a password', 'https://user:pass@githubusercontent.com/u/1'],
      ['a protocol-relative URL', '//evil.com/u/1'],
      ['a data: URL', 'data:image/svg+xml,<svg/>'],
      ['a blob: URL', 'blob:https://avatars.githubusercontent.com/abc'],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a trailing-dot host', 'https://githubusercontent.com./u/1'],
      ['a non-URL string', 'not a url'],
    ])('drops the avatar but keeps login for %s', async (_label, avatar) => {
      stubFetch(async () => jsonResponse({ login: 'octocat', avatar_url: avatar }));

      const result = await validateToken('ghp_x');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.login).toBe('octocat');
        expect(result.avatarUrl).toBeUndefined();
      }
    });
  });
});
