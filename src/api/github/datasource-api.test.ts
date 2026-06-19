/**
 * Tests for the Property Inspector datasource API functions (github-api.ts).
 *
 * Exercises fetchUserRepos, fetchRepoWorkflows, fetchRepoBranches,
 * and fetchRepoEnvironments with mocked global fetch.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchUserRepos,
  fetchRepoWorkflows,
  fetchRepoBranches,
  fetchRepoEnvironments,
  validateTokenStatus,
} from './index';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeHeaders(): Headers {
  return new Headers({
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': '9999999999',
    'x-ratelimit-used': '1',
  });
}

function makeHeadersWithScopes(scopes: string): Headers {
  const h = makeHeaders();
  h.set('x-oauth-scopes', scopes);
  return h;
}

function makeHeadersRateLimited(): Headers {
  return new Headers({
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': '9999999999',
    'x-ratelimit-used': '5000',
  });
}

function mockFetchResponse(data: unknown, status = 200, linkHeader?: string): Response {
  const headers = makeHeaders();
  if (linkHeader) {
    headers.set('link', linkHeader);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('Datasource API', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── fetchUserRepos ──────────────────────────

  describe('fetchUserRepos', () => {
    it('returns a prompt when no token is provided', async () => {
      const items = await fetchUserRepos();
      expect(items).toHaveLength(1);
      expect(items[0].value).toBe('');
      expect(items[0].disabled).toBe(true);
      expect(items[0].label).toContain('Enter a GitHub token');

      // Should NOT call fetch
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns a prompt when token is empty string', async () => {
      const items = await fetchUserRepos('');
      expect(items).toHaveLength(1);
      expect(items[0].disabled).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('fetches repos successfully with token', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse([
          { full_name: 'owner/repo1', private: false, description: 'Desc 1' },
          { full_name: 'owner/repo2', private: true, description: null },
          { full_name: 'org/shared', private: false, description: 'Shared repo' },
        ]),
      );

      const items = await fetchUserRepos('ghp_test123');

      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ label: 'owner/repo1', value: 'owner/repo1' });
      expect(items[1]).toEqual({ label: '🔒 owner/repo2', value: 'owner/repo2' });
      expect(items[2]).toEqual({ label: 'org/shared', value: 'org/shared' });
    });

    it('uses correct URL with sort, direction, visibility, and affiliation params', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      await fetchUserRepos('ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/user/repos');
      expect(url).toContain('per_page=100');
      expect(url).toContain('sort=pushed');
      expect(url).toContain('direction=desc');
      expect(url).toContain('visibility=all');
      expect(url).toContain('affiliation=owner,collaborator,organization_member');
    });

    it('sends Bearer token in Authorization header', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      await fetchUserRepos('ghp_mytoken');

      const opts = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer ghp_mytoken');
    });

    it('returns invalid token message on 401', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Bad credentials' }, 401),
      );

      const items = await fetchUserRepos('ghp_bad');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Invalid or expired token');
      expect(items[0].value).toBe('');
      expect(items[0].disabled).toBe(true);
    });

    it('returns permission error on 403', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Forbidden' }, 403),
      );

      const items = await fetchUserRepos('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('permission');
      expect(items[0].label).toContain('Metadata');
      expect(items[0].disabled).toBe(true);
    });

    it('returns API error message on 500', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Server Error' }, 500),
      );

      const items = await fetchUserRepos('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('API error');
      expect(items[0].label).toContain('500');
      expect(items[0].disabled).toBe(true);
    });

    it('returns network error on fetch failure', async () => {
      vi.useFakeTimers();
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

      const promise = fetchUserRepos('ghp_test');
      await vi.advanceTimersByTimeAsync(10000);
      const items = await promise;

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Network error');
      expect(items[0].disabled).toBe(true);
      vi.useRealTimers();
    });

    it("returns 'no repos found' when response is empty array", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      const items = await fetchUserRepos('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('No repositories found');
      expect(items[0].disabled).toBe(true);
    });

    it('prefixes private repos with lock emoji', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse([
          { full_name: 'owner/public-repo', private: false, description: null },
          { full_name: 'owner/private-repo', private: true, description: null },
        ]),
      );

      const items = await fetchUserRepos('ghp_test');

      expect(items[0].label).not.toContain('🔒');
      expect(items[1].label).toContain('🔒');
    });

    it('handles many repos (100)', async () => {
      const repos = Array.from({ length: 100 }, (_, i) => ({
        full_name: `owner/repo-${i}`,
        private: i % 2 === 0,
        description: null,
      }));
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(repos));

      const items = await fetchUserRepos('ghp_test');
      expect(items).toHaveLength(100);
    });

    it('paginates through multiple pages of repos', async () => {
      const page1Repos = Array.from({ length: 100 }, (_, i) => ({
        full_name: `owner/public-${i}`,
        private: false,
        description: null,
      }));
      const page2Repos = [
        { full_name: 'owner/private-1', private: true, description: null },
        { full_name: 'owner/private-2', private: true, description: null },
      ];

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse(
            page1Repos,
            200,
            '<https://api.github.com/user/repos?page=2&per_page=100>; rel="next", <https://api.github.com/user/repos?page=2&per_page=100>; rel="last"',
          ),
        )
        .mockResolvedValueOnce(mockFetchResponse(page2Repos));

      const items = await fetchUserRepos('ghp_test');

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(items).toHaveLength(102);
      expect(items[100].label).toContain('🔒');
      expect(items[100].value).toBe('owner/private-1');
      expect(items[101].value).toBe('owner/private-2');
    });

    it('stops paginating when no Link next header', async () => {
      const repos = [{ full_name: 'owner/repo1', private: false, description: null }];
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(repos));

      const items = await fetchUserRepos('ghp_test');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(items).toHaveLength(1);
    });

    it('returns partial results when a subsequent page fails with network error', async () => {
      const page1Repos = [{ full_name: 'owner/repo1', private: false, description: null }];

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse(
            page1Repos,
            200,
            '<https://api.github.com/user/repos?page=2>; rel="next"',
          ),
        )
        .mockRejectedValueOnce(new Error('Network error'));

      const items = await fetchUserRepos('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].value).toBe('owner/repo1');
    });

    it('returns partial results when a subsequent page returns non-ok status', async () => {
      const page1Repos = [{ full_name: 'owner/repo1', private: true, description: null }];

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse(
            page1Repos,
            200,
            '<https://api.github.com/user/repos?page=2>; rel="next"',
          ),
        )
        .mockResolvedValueOnce(mockFetchResponse({ message: 'rate limited' }, 403));

      const items = await fetchUserRepos('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('🔒');
    });

    it('does not follow an off-origin Link "next" URL (no PAT leak to non-GitHub host)', async () => {
      const page1Repos = [{ full_name: 'owner/repo1', private: false, description: null }];
      const leakedRepos = [{ full_name: 'evil/leak', private: false, description: null }];

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse(
            page1Repos,
            200,
            '<https://evil.example.com/user/repos?page=2&per_page=100>; rel="next"',
          ),
        )
        .mockResolvedValueOnce(mockFetchResponse(leakedRepos));

      const items = await fetchUserRepos('ghp_secret');

      // Pagination must stop: only the on-origin first page is fetched.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // The PAT must never be sent to the forged off-origin host.
      for (const call of vi.mocked(globalThis.fetch).mock.calls) {
        expect(String(call[0])).not.toContain('evil.example.com');
      }

      // Only the legitimate first-page repo is returned.
      expect(items).toHaveLength(1);
      expect(items[0].value).toBe('owner/repo1');
    });
  });

  // ── fetchRepoWorkflows ──────────────────────

  describe('fetchRepoWorkflows', () => {
    it('fetches workflows successfully', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({
          total_count: 2,
          workflows: [
            { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
            { id: 2, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' },
          ],
        }),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');

      // First item is "All Workflows"
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ label: 'All Workflows', value: '' });
      expect(items[1]).toEqual({ label: 'CI (ci.yml)', value: 'ci.yml' });
      expect(items[2]).toEqual({ label: 'Deploy (deploy.yml)', value: 'deploy.yml' });
    });

    it('uses correct URL with owner/repo', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflows: [] }),
      );

      await fetchRepoWorkflows('my-org', 'my-repo', 'ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/repos/my-org/my-repo/actions/workflows');
      expect(url).toContain('per_page=100');
    });

    it('URL-encodes special characters', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflows: [] }),
      );

      await fetchRepoWorkflows('my org', 'my repo', 'ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('my%20org');
      expect(url).toContain('my%20repo');
    });

    it('returns error item on 404', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Not Found' }, 404),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('not found');
      expect(items[0].disabled).toBe(true);
    });

    it('returns permission error on 403', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Forbidden' }, 403),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Actions');
      expect(items[0].label).toContain('permission');
      expect(items[0].disabled).toBe(true);
    });

    it('returns generic error on 500', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Server Error' }, 500),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Could not load workflows');
      expect(items[0].disabled).toBe(true);
    });

    it('returns error item when no workflows found', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflows: [] }),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('No workflows found');
      expect(items[0].disabled).toBe(true);
    });

    it('extracts filename from workflow path', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({
          total_count: 1,
          workflows: [
            { id: 1, name: 'Build', path: '.github/workflows/build-and-test.yml', state: 'active' },
          ],
        }),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');

      expect(items[1].value).toBe('build-and-test.yml');
      expect(items[1].label).toBe('Build (build-and-test.yml)');
    });

    it('handles workflow with no slashes in path', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({
          total_count: 1,
          workflows: [{ id: 1, name: 'Simple', path: 'simple.yml', state: 'active' }],
        }),
      );

      const items = await fetchRepoWorkflows('owner', 'repo', 'ghp_test');
      expect(items[1].value).toBe('simple.yml');
    });

    it('works without token', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflows: [] }),
      );

      await fetchRepoWorkflows('owner', 'repo');

      const opts = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // ── fetchRepoBranches ───────────────────────

  describe('fetchRepoBranches', () => {
    it('fetches branches successfully', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse([{ name: 'main' }, { name: 'develop' }, { name: 'feature/auth' }]),
      );

      const items = await fetchRepoBranches('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(4);
      expect(items[0]).toEqual({ label: 'All Branches', value: '' });
      expect(items[1]).toEqual({ label: 'main', value: 'main' });
      expect(items[2]).toEqual({ label: 'develop', value: 'develop' });
      expect(items[3]).toEqual({ label: 'feature/auth', value: 'feature/auth' });
    });

    it('uses correct URL', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      await fetchRepoBranches('owner', 'repo', 'ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/repos/owner/repo/branches');
      expect(url).toContain('per_page=100');
    });

    it('returns permission error on 403', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Forbidden' }, 403),
      );

      const items = await fetchRepoBranches('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('permission');
      expect(items[0].disabled).toBe(true);
    });

    it('returns generic error on 500', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Server Error' }, 500),
      );

      const items = await fetchRepoBranches('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Could not load branches');
      expect(items[0].disabled).toBe(true);
    });

    it("returns only 'All Branches' when repo has no branches", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      const items = await fetchRepoBranches('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ label: 'All Branches', value: '' });
    });

    it('handles branch names with special characters', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse([
          { name: 'feat/my-feature' },
          { name: 'release/v1.0.0' },
          { name: 'user/john/fix-bug' },
        ]),
      );

      const items = await fetchRepoBranches('owner', 'repo', 'ghp_test');

      expect(items[1].value).toBe('feat/my-feature');
      expect(items[2].value).toBe('release/v1.0.0');
      expect(items[3].value).toBe('user/john/fix-bug');
    });
  });

  // ── fetchRepoEnvironments ───────────────────

  describe('fetchRepoEnvironments', () => {
    it('fetches environments successfully', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({
          total_count: 3,
          environments: [
            { name: 'production', id: 1 },
            { name: 'staging', id: 2 },
            { name: 'development', id: 3 },
          ],
        }),
      );

      const items = await fetchRepoEnvironments('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(4);
      expect(items[0]).toEqual({ label: 'All Environments', value: '' });
      expect(items[1]).toEqual({ label: 'production', value: 'production' });
      expect(items[2]).toEqual({ label: 'staging', value: 'staging' });
      expect(items[3]).toEqual({ label: 'development', value: 'development' });
    });

    it('uses correct URL', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, environments: [] }),
      );

      await fetchRepoEnvironments('owner', 'repo', 'ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/repos/owner/repo/environments');
    });

    it('gracefully handles 404 (no environments configured)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Not Found' }, 404),
      );

      const items = await fetchRepoEnvironments('owner', 'repo', 'ghp_test');

      // Should fallback to just "All Environments"
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ label: 'All Environments', value: '' });
    });

    it('returns permission warning on 403 (insufficient permissions)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Forbidden' }, 403),
      );

      const items = await fetchRepoEnvironments('owner', 'repo', 'ghp_test');

      // Should include "All Environments" as first item plus a permission warning
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0]).toEqual({ label: 'All Environments', value: '' });
      // Second item should warn about permissions
      expect(items[1]?.label).toContain('permission');
      expect(items[1]?.disabled).toBe(true);
    });

    it("returns only 'All Environments' when no environments exist", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, environments: [] }),
      );

      const items = await fetchRepoEnvironments('owner', 'repo', 'ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ label: 'All Environments', value: '' });
    });
  });

  // ── validateTokenStatus ────────────────────

  describe('validateTokenStatus', () => {
    it('returns prompt when no token is provided', async () => {
      const items = await validateTokenStatus();

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Enter a GitHub token');
      expect(items[0].value).toBe('no-token');
    });

    it('returns invalid message on 401', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Bad credentials' }, 401),
      );

      const items = await validateTokenStatus('ghp_bad');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('invalid or revoked');
      expect(items[0].value).toBe('invalid');
      expect(items[0].disabled).toBe(true);
    });

    it('returns rate limit message on 403 with zero remaining', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: false,
        status: 403,
        headers: makeHeadersRateLimited(),
        json: () => Promise.resolve({ message: 'rate limit' }),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Rate limited');
      expect(items[0].value).toBe('rate-limited');
    });

    it('returns forbidden message on 403 without rate limit', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Forbidden' }, 403),
      );

      const items = await validateTokenStatus('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('lacks basic API access');
      expect(items[0].value).toBe('forbidden');
    });

    it('returns error on unexpected status code', async () => {
      vi.useFakeTimers();
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ message: 'error' }, 502));

      const promise = validateTokenStatus('ghp_test');
      await vi.advanceTimersByTimeAsync(10000);
      const items = await promise;

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('502');
      expect(items[0].value).toBe('error');
      vi.useRealTimers();
    });

    it('returns network error on fetch failure', async () => {
      vi.useFakeTimers();
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ENOTFOUND'));

      const promise = validateTokenStatus('ghp_test');
      await vi.advanceTimersByTimeAsync(10000);
      const items = await promise;

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Network error');
      expect(items[0].value).toBe('network-error');
      vi.useRealTimers();
    });

    it('identifies classic token with scopes', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: makeHeadersWithScopes('repo, read:org, workflow'),
        json: () => Promise.resolve({ login: 'testuser' }),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items[0].label).toContain('@testuser');
      expect(items[0].label).toContain('classic');
      expect(items[0].value).toBe('valid');
      // Second item should list scopes
      expect(items[1].label).toContain('Scopes:');
      expect(items[1].label).toContain('repo');
    });

    it('warns about missing repo scope on classic token', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: makeHeadersWithScopes('read:org'),
        json: () => Promise.resolve({ login: 'testuser' }),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items[0].label).toContain('@testuser');
      // Should have scope list + missing repo warning
      const warningItem = items.find((i) => i.label.includes('Missing repo scope'));
      expect(warningItem).toBeTruthy();
      expect(warningItem?.disabled).toBe(true);
    });

    it('warns about empty scopes on classic token', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: makeHeadersWithScopes(''),
        json: () => Promise.resolve({ login: 'testuser' }),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items[0].label).toContain('@testuser');
      const warningItem = items.find((i) => i.label.includes('No scopes'));
      expect(warningItem).toBeTruthy();
    });

    it('identifies fine-grained token (no scopes header)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: makeHeaders(), // no x-oauth-scopes
        json: () => Promise.resolve({ login: 'testuser' }),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      expect(items).toHaveLength(2);
      expect(items[0].label).toContain('@testuser');
      expect(items[0].label).toContain('fine-grained');
      expect(items[0].value).toBe('valid');
      expect(items[1].label).toContain('Check token settings');
    });

    it('handles invalid JSON response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: makeHeaders(),
        json: () => Promise.reject(new Error('invalid json')),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Invalid response');
    });

    it('does not mark classic token with public_repo scope as missing repo', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: makeHeadersWithScopes('public_repo'),
        json: () => Promise.resolve({ login: 'testuser' }),
      } as unknown as Response);

      const items = await validateTokenStatus('ghp_test');

      const warningItem = items.find((i) => i.label.includes('Missing repo scope'));
      expect(warningItem).toBeUndefined();
    });
  });

  // ── DataSourceItem shape ────────────────────

  describe('DataSourceItem shape', () => {
    it('all items returned by fetchUserRepos have label and value', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse([{ full_name: 'a/b', private: false, description: null }]),
      );

      const items = await fetchUserRepos('ghp_test');

      for (const item of items) {
        expect(item).toHaveProperty('label');
        expect(item).toHaveProperty('value');
        expect(typeof item.label).toBe('string');
        expect(typeof item.value).toBe('string');
      }
    });

    it('disabled items from fetchUserRepos are valid DataSourceItems', async () => {
      const items = await fetchUserRepos();

      for (const item of items) {
        expect(item.label).toBeTruthy();
        expect(typeof item.value).toBe('string');
        expect(item.disabled).toBe(true);
      }
    });
  });
});
