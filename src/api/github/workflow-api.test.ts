/**
 * Tests for the workflow-related GitHub API functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLatestWorkflowRun,
  fetchLatestDeploymentStatus,
  fetchWorkflowInfo,
  getWorkflowDisplayStatus,
  getWorkflowStatusLabel,
  GitHubApiError,
  type WorkflowRun,
} from './index';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeHeaders(overrides?: Record<string, string>): Headers {
  return new Headers({
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': '9999999999',
    'x-ratelimit-used': '1',
    ...overrides,
  });
}

function mockFetchResponse(data: unknown, status = 200, ok = true, headers?: Headers) {
  return {
    ok,
    status,
    headers: headers ?? makeHeaders(),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function makeWorkflowRunData(overrides?: Record<string, unknown>) {
  return {
    id: 12345,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    event: 'push',
    display_title: 'Update README',
    run_number: 42,
    html_url: 'https://github.com/owner/repo/actions/runs/12345',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:05:00Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('Workflow API', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── fetchLatestWorkflowRun ──────────────────

  describe('fetchLatestWorkflowRun', () => {
    it('fetches the latest workflow run for a repository', async () => {
      const runData = makeWorkflowRunData();
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 1, workflow_runs: [runData] }),
      );

      const result = await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test');

      expect(result).not.toBeNull();
      expect(result?.id).toBe(12345);
      expect(result?.name).toBe('CI');
      expect(result?.status).toBe('completed');
      expect(result?.conclusion).toBe('success');
      expect(result?.head_branch).toBe('main');
      expect(result?.run_number).toBe(42);
    });

    it('returns null when no workflow runs exist', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      const result = await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test');
      expect(result).toBeNull();
    });

    it('uses correct URL for all-workflows query', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/repos/owner/repo/actions/runs');
      expect(url).toContain('per_page=1');
    });

    it('uses correct URL when workflow file is specified', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test', undefined, 'deploy.yml');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/actions/workflows/deploy.yml/runs');
    });

    it('appends branch filter when specified', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test', 'main');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('branch=main');
    });

    it('includes auth header when token is provided', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      await fetchLatestWorkflowRun('owner', 'repo', 'ghp_testtoken123');

      const fetchOpts = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer ghp_testtoken123');
    });

    it('includes API version header', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test');

      const fetchOpts = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    });

    it('throws GitHubApiError on 401 Unauthorized', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Bad credentials' }, 401, false),
      );

      await expect(fetchLatestWorkflowRun('owner', 'repo', 'bad_token')).rejects.toThrow(
        GitHubApiError,
      );
      await expect(fetchLatestWorkflowRun('owner', 'repo', 'bad_token')).rejects.toThrow(
        /Invalid or expired/,
      );
    });

    it('throws GitHubApiError on 403 rate limit', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse(
          { message: 'rate limit' },
          403,
          false,
          makeHeaders({ 'x-ratelimit-remaining': '0' }),
        ),
      );

      await expect(fetchLatestWorkflowRun('owner', 'repo', 'ghp_test')).rejects.toThrow(
        /rate limit exceeded/,
      );
    });

    it('throws GitHubApiError on 403 access denied', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Forbidden' }, 403, false),
      );

      await expect(fetchLatestWorkflowRun('owner', 'repo', 'ghp_test')).rejects.toThrow(
        /Access denied/,
      );
    });

    it('throws GitHubApiError on 404 Not Found', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Not Found' }, 404, false),
      );

      await expect(fetchLatestWorkflowRun('owner', 'repo', 'ghp_test')).rejects.toThrow(
        /not found or is private/,
      );
    });

    it('throws GitHubApiError on 500 Server Error', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Internal Server Error' }, 500, false),
      );

      await expect(fetchLatestWorkflowRun('owner', 'repo', 'ghp_test')).rejects.toThrow(
        GitHubApiError,
      );
    });

    it('handles in_progress workflow run', async () => {
      const runData = makeWorkflowRunData({ status: 'in_progress', conclusion: null });
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 1, workflow_runs: [runData] }),
      );

      const result = await fetchLatestWorkflowRun('owner', 'repo', 'ghp_test');
      expect(result?.status).toBe('in_progress');
      expect(result?.conclusion).toBeNull();
    });

    it('URL-encodes special characters in owner and repo', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ total_count: 0, workflow_runs: [] }),
      );

      await fetchLatestWorkflowRun('my org', 'my repo', 'ghp_test');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('my%20org');
      expect(url).toContain('my%20repo');
    });
  });

  // ── fetchLatestDeploymentStatus ─────────────

  describe('fetchLatestDeploymentStatus', () => {
    it('fetches latest deployment with its status', async () => {
      // First call: list deployments, second call: deployment statuses
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse([
            {
              id: 100,
              environment: 'production',
              description: 'Deploy to prod',
              created_at: '2024-01-15T10:00:00Z',
            },
          ]),
        )
        .mockResolvedValueOnce(
          mockFetchResponse([
            {
              state: 'success',
              description: 'Deployment finished',
              environment: 'production',
              created_at: '2024-01-15T10:05:00Z',
              log_url: 'https://example.com/logs',
            },
          ]),
        );

      const result = await fetchLatestDeploymentStatus('owner', 'repo', 'ghp_test');

      expect(result).not.toBeNull();
      expect(result?.id).toBe(100);
      expect(result?.state).toBe('success');
      expect(result?.environment).toBe('production');
      expect(result?.log_url).toBe('https://example.com/logs');
    });

    it('returns null when no deployments exist', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      const result = await fetchLatestDeploymentStatus('owner', 'repo', 'ghp_test');
      expect(result).toBeNull();
    });

    it('returns pending status when deployment has no statuses', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse([
            {
              id: 200,
              environment: 'staging',
              description: 'Deploy to staging',
              created_at: '2024-01-15T10:00:00Z',
            },
          ]),
        )
        .mockResolvedValueOnce(mockFetchResponse([]));

      const result = await fetchLatestDeploymentStatus('owner', 'repo', 'ghp_test');

      expect(result).not.toBeNull();
      expect(result?.state).toBe('pending');
      expect(result?.environment).toBe('staging');
    });

    it('appends environment filter when specified', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

      await fetchLatestDeploymentStatus('owner', 'repo', 'ghp_test', 'production');

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('environment=production');
    });

    it('handles in_progress deployment status', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          mockFetchResponse([
            {
              id: 300,
              environment: 'production',
              description: '',
              created_at: '2024-01-15T10:00:00Z',
            },
          ]),
        )
        .mockResolvedValueOnce(
          mockFetchResponse([
            {
              state: 'in_progress',
              description: 'Deploying...',
              environment: 'production',
              created_at: '2024-01-15T10:01:00Z',
              log_url: '',
            },
          ]),
        );

      const result = await fetchLatestDeploymentStatus('owner', 'repo', 'ghp_test');
      expect(result?.state).toBe('in_progress');
    });

    it('throws on 401 Unauthorized', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ message: 'Bad credentials' }, 401, false),
      );

      await expect(fetchLatestDeploymentStatus('owner', 'repo', 'bad_token')).rejects.toThrow(
        GitHubApiError,
      );
    });
  });

  // ── fetchWorkflowInfo ───────────────────────

  describe('fetchWorkflowInfo', () => {
    it('fetches both workflow runs and deployments in parallel', async () => {
      const runData = makeWorkflowRunData();

      // Workflow runs call
      vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
        const urlStr = url as string;
        if (urlStr.includes('/actions/runs')) {
          return mockFetchResponse({ total_count: 1, workflow_runs: [runData] });
        }
        if (urlStr.includes('/deployments') && !urlStr.includes('/statuses')) {
          return mockFetchResponse([
            {
              id: 100,
              environment: 'production',
              description: '',
              created_at: '2024-01-15T10:00:00Z',
            },
          ]);
        }
        if (urlStr.includes('/statuses')) {
          return mockFetchResponse([
            {
              state: 'success',
              description: 'Done',
              environment: 'production',
              created_at: '2024-01-15T10:05:00Z',
              log_url: '',
            },
          ]);
        }
        return mockFetchResponse({});
      });

      const info = await fetchWorkflowInfo('owner', 'repo', 'ghp_test');

      expect(info.latestRun).not.toBeNull();
      expect(info.latestRun?.name).toBe('CI');
      expect(info.deployment).not.toBeNull();
      expect(info.deployment?.state).toBe('success');
    });

    it('returns null for both when no data exists', async () => {
      vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
        const urlStr = url as string;
        if (urlStr.includes('/actions/runs')) {
          return mockFetchResponse({ total_count: 0, workflow_runs: [] });
        }
        return mockFetchResponse([]);
      });

      const info = await fetchWorkflowInfo('owner', 'repo', 'ghp_test');
      expect(info.latestRun).toBeNull();
      expect(info.deployment).toBeNull();
    });

    it('propagates workflow run errors but catches deployment errors', async () => {
      vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
        const urlStr = url as string;
        if (urlStr.includes('/actions/runs')) {
          return mockFetchResponse({ message: 'Server Error' }, 500, false);
        }
        return mockFetchResponse([]);
      });

      // Workflow run errors should propagate (not silently become null)
      await expect(fetchWorkflowInfo('owner', 'repo', 'ghp_test')).rejects.toThrow();
    });

    it('returns workflow run data when deployment fetch fails', async () => {
      const runData = makeWorkflowRunData();

      vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
        const urlStr = url as string;
        if (urlStr.includes('/actions/runs')) {
          return mockFetchResponse({ total_count: 1, workflow_runs: [runData] });
        }
        // Deployment calls fail
        return mockFetchResponse({ message: 'Server Error' }, 500, false);
      });

      const info = await fetchWorkflowInfo('owner', 'repo', 'ghp_test');
      // Workflow run succeeds, deployment error caught gracefully
      expect(info.latestRun).not.toBeNull();
      expect(info.latestRun?.name).toBe('CI');
      expect(info.deployment).toBeNull();
    });

    it('passes options to underlying calls', async () => {
      vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
        const urlStr = url as string;
        if (urlStr.includes('/actions/workflows/deploy.yml')) {
          return mockFetchResponse({ total_count: 0, workflow_runs: [] });
        }
        if (urlStr.includes('/deployments') && !urlStr.includes('/statuses')) {
          return mockFetchResponse([]);
        }
        return mockFetchResponse({});
      });

      await fetchWorkflowInfo('owner', 'repo', 'ghp_test', {
        branch: 'main',
        workflowFile: 'deploy.yml',
        environment: 'production',
      });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const urls = calls.map((c) => c[0] as string);

      expect(urls.some((u) => u.includes('deploy.yml'))).toBe(true);
      expect(urls.some((u) => u.includes('branch=main'))).toBe(true);
      expect(urls.some((u) => u.includes('environment=production'))).toBe(true);
    });
  });

  // ── getWorkflowDisplayStatus ────────────────

  describe('getWorkflowDisplayStatus', () => {
    it('returns conclusion when status is completed and conclusion is set', () => {
      const run: WorkflowRun = {
        id: 1,
        name: 'CI',
        status: 'completed',
        conclusion: 'failure',
        head_branch: 'main',
        event: 'push',
        display_title: 'Test',
        run_number: 1,
        html_url: '',
        created_at: '',
        updated_at: '',
      };
      expect(getWorkflowDisplayStatus(run)).toBe('failure');
    });

    it("returns 'completed' when conclusion is null", () => {
      const run: WorkflowRun = {
        id: 1,
        name: 'CI',
        status: 'completed',
        conclusion: null,
        head_branch: 'main',
        event: 'push',
        display_title: 'Test',
        run_number: 1,
        html_url: '',
        created_at: '',
        updated_at: '',
      };
      expect(getWorkflowDisplayStatus(run)).toBe('completed');
    });

    it('returns status when not completed', () => {
      const run: WorkflowRun = {
        id: 1,
        name: 'CI',
        status: 'in_progress',
        conclusion: null,
        head_branch: 'main',
        event: 'push',
        display_title: 'Test',
        run_number: 1,
        html_url: '',
        created_at: '',
        updated_at: '',
      };
      expect(getWorkflowDisplayStatus(run)).toBe('in_progress');
    });

    it('returns queued status', () => {
      const run: WorkflowRun = {
        id: 1,
        name: 'CI',
        status: 'queued',
        conclusion: null,
        head_branch: 'main',
        event: 'push',
        display_title: 'Test',
        run_number: 1,
        html_url: '',
        created_at: '',
        updated_at: '',
      };
      expect(getWorkflowDisplayStatus(run)).toBe('queued');
    });
  });

  // ── getWorkflowStatusLabel ──────────────────

  describe('getWorkflowStatusLabel', () => {
    it("returns 'Success' for success", () => {
      expect(getWorkflowStatusLabel('success')).toBe('Success');
    });

    it("returns 'Failed' for failure", () => {
      expect(getWorkflowStatusLabel('failure')).toBe('Failed');
    });

    it("returns 'Running' for in_progress", () => {
      expect(getWorkflowStatusLabel('in_progress')).toBe('Running');
    });

    it("returns 'Queued' for queued", () => {
      expect(getWorkflowStatusLabel('queued')).toBe('Queued');
    });

    it("returns 'Cancelled' for cancelled", () => {
      expect(getWorkflowStatusLabel('cancelled')).toBe('Cancelled');
    });

    it("returns 'Timed Out' for timed_out", () => {
      expect(getWorkflowStatusLabel('timed_out')).toBe('Timed Out');
    });

    it("returns 'Waiting' for waiting", () => {
      expect(getWorkflowStatusLabel('waiting')).toBe('Waiting');
    });

    it("returns 'Pending' for pending", () => {
      expect(getWorkflowStatusLabel('pending')).toBe('Pending');
    });

    it('returns raw status for unknown values', () => {
      expect(getWorkflowStatusLabel('custom_status')).toBe('custom_status');
    });
  });
});
