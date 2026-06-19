/**
 * Property Inspector data source functions for dropdown population.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z } from 'zod';

import { GITHUB_API_BASE, buildHeaders, fetchWithRetry, parseRateLimitHeaders } from './core';
import {
  UserResponseSchema,
  UserRepoResponseSchema,
  WorkflowListResponseSchema,
  EnvironmentListResponseSchema,
} from './schemas';

/** Item shape for a dropdown / select option. */
export interface DataSourceItem {
  label: string;
  value: string;
  disabled?: boolean;
}

/**
 * Validates a GitHub token by calling the /user endpoint.
 * Returns detailed status: whether the token is valid, the user login,
 * token type (classic vs. fine-grained), and granted scopes.
 *
 * This gives the PI clear feedback to distinguish "token is invalid"
 * from "token is valid but lacks specific permissions".
 *
 * @param token - GitHub personal access token to validate
 * @returns DataSourceItem[] with validation results
 */
export async function validateTokenStatus(token?: string): Promise<DataSourceItem[]> {
  if (!token) {
    return [{ label: 'Enter a GitHub token', value: 'no-token' }];
  }

  let response: Response;
  try {
    response = await fetchWithRetry(
      `${GITHUB_API_BASE}/user`,
      { headers: buildHeaders(token) },
      'validateTokenStatus',
    );
  } catch {
    return [
      { label: '⚠ Network error — check connection', value: 'network-error', disabled: true },
    ];
  }

  if (response.status === 401) {
    return [{ label: '⚠ Token is invalid or revoked', value: 'invalid', disabled: true }];
  }

  if (response.status === 403) {
    const rateLimitInfo = parseRateLimitHeaders(response.headers);
    if (rateLimitInfo.remaining === 0) {
      const resetTime = rateLimitInfo.reset.toLocaleTimeString();
      return [
        { label: `⚠ Rate limited — resets at ${resetTime}`, value: 'rate-limited', disabled: true },
      ];
    }
    return [{ label: '⚠ Token lacks basic API access', value: 'forbidden', disabled: true }];
  }

  if (!response.ok) {
    return [{ label: `⚠ GitHub error (${response.status})`, value: 'error', disabled: true }];
  }

  let user: { login: string };
  try {
    user = UserResponseSchema.parse(await response.json());
  } catch {
    return [{ label: '⚠ Invalid response from GitHub', value: 'parse-error', disabled: true }];
  }

  const scopeHeader = response.headers.get('x-oauth-scopes');

  if (scopeHeader !== null) {
    // Classic personal access token — X-OAuth-Scopes header is present
    const scopes = scopeHeader
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const items: DataSourceItem[] = [{ label: `✓ @${user.login} · classic token`, value: 'valid' }];

    if (scopes.length > 0) {
      items.push({ label: `Scopes: ${scopes.join(', ')}`, value: '', disabled: true });
      // Check for scopes needed by this plugin
      if (!scopes.includes('repo') && !scopes.includes('public_repo')) {
        items.push({
          label: '⚠ Missing repo scope — enable the repo scope on your token',
          value: '',
          disabled: true,
        });
      } else if (scopes.includes('public_repo') && !scopes.includes('repo')) {
        items.push({
          label:
            "⚠ Only public_repo scope — private repos won't appear. Enable the full repo scope.",
          value: '',
          disabled: true,
        });
      }
    } else {
      items.push({
        label: '⚠ No scopes granted — token has very limited access',
        value: '',
        disabled: true,
      });
    }

    return items;
  }

  // Fine-grained personal access token — no X-OAuth-Scopes header
  return [
    { label: `✓ @${user.login} · fine-grained token`, value: 'valid' },
    { label: 'Check token settings for required permissions', value: '', disabled: true },
  ];
}

/**
 * Fetches repositories accessible to the authenticated user.
 * Returns them as datasource items sorted by most recently pushed.
 *
 * @param token - GitHub personal access token (required)
 * @returns Array of repo items for the PI datasource dropdown
 */
export async function fetchUserRepos(token?: string): Promise<DataSourceItem[]> {
  if (!token) {
    return [{ label: '⚠ Enter a GitHub token first', value: '', disabled: true }];
  }

  const headers = buildHeaders(token);
  let url: string | null =
    `${GITHUB_API_BASE}/user/repos?per_page=100&sort=pushed&direction=desc&visibility=all&affiliation=owner,collaborator,organization_member`;

  const allRepos: Array<{ full_name: string; private: boolean; description: string | null }> = [];

  // Paginate through all pages of results
  while (url) {
    let response: Response;
    try {
      response = await fetchWithRetry(url, { headers }, 'fetchUserRepos');
    } catch {
      if (allRepos.length > 0) break; // Return what we have so far
      return [{ label: '⚠ Network error — check connection', value: '', disabled: true }];
    }

    if (!response.ok) {
      if (allRepos.length > 0) break; // Return what we have so far
      if (response.status === 401) {
        return [{ label: '⚠ Invalid or expired token', value: '', disabled: true }];
      }
      if (response.status === 403) {
        return [
          {
            label: '⚠ Token lacks permission — enable Metadata read access',
            value: '',
            disabled: true,
          },
        ];
      }
      return [{ label: `⚠ GitHub API error (${response.status})`, value: '', disabled: true }];
    }

    let repos: Array<{ full_name: string; private: boolean; description: string | null }>;
    try {
      repos = z.array(UserRepoResponseSchema).parse(await response.json());
    } catch {
      if (allRepos.length > 0) break;
      return [{ label: '⚠ Invalid response from GitHub', value: '', disabled: true }];
    }

    if (Array.isArray(repos)) {
      allRepos.push(...repos);
    }

    // Parse Link header for next page
    url = parseNextPageUrl(response.headers.get('link'));
  }

  if (allRepos.length === 0) {
    return [{ label: 'No repositories found', value: '', disabled: true }];
  }

  return allRepos.map((r) => ({
    label: `${r.private ? '🔒 ' : ''}${r.full_name}`,
    value: r.full_name,
  }));
}

/**
 * Parses the GitHub `Link` header to extract the URL for the next page.
 * Returns null if there is no next page.
 */
function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/**
 * Fetches workflows for a given repository.
 * Returns them as datasource items for the PI dropdown.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of workflow items
 */
export async function fetchRepoWorkflows(
  owner: string,
  repo: string,
  token?: string,
): Promise<DataSourceItem[]> {
  const headers = buildHeaders(token);
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows?per_page=100`;

  const response = await fetchWithRetry(url, { headers }, 'fetchRepoWorkflows');

  if (!response.ok) {
    if (response.status === 401) {
      return [{ label: '⚠ Invalid or expired token', value: '', disabled: true }];
    }
    if (response.status === 403) {
      return [{ label: '⚠ Token lacks Actions read permission', value: '', disabled: true }];
    }
    if (response.status === 404) {
      return [{ label: '⚠ Repository not found', value: '', disabled: true }];
    }
    return [
      { label: `⚠ Could not load workflows (${response.status})`, value: '', disabled: true },
    ];
  }

  const data = WorkflowListResponseSchema.parse(await response.json());

  if (data.workflows.length === 0) {
    return [{ label: 'No workflows found', value: '', disabled: true }];
  }

  // First item: "All workflows" option (no filter)
  const items: DataSourceItem[] = [{ label: 'All Workflows', value: '' }];

  for (const wf of data.workflows) {
    // Extract just the filename from full path (e.g. ".github/workflows/ci.yml" → "ci.yml")
    const fileName = wf.path.split('/').pop() ?? wf.path;
    items.push({
      label: `${wf.name} (${fileName})`,
      value: fileName,
    });
  }

  return items;
}

/**
 * Fetches branches for a given repository.
 * Returns them as datasource items for the PI dropdown.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of branch items
 */
export async function fetchRepoBranches(
  owner: string,
  repo: string,
  token?: string,
): Promise<DataSourceItem[]> {
  const headers = buildHeaders(token);
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;

  const response = await fetchWithRetry(url, { headers }, 'fetchRepoBranches');

  if (!response.ok) {
    if (response.status === 401) {
      return [{ label: '⚠ Invalid or expired token', value: '', disabled: true }];
    }
    if (response.status === 403) {
      return [
        { label: '⚠ Token lacks Contents/Metadata read permission', value: '', disabled: true },
      ];
    }
    if (response.status === 404) {
      return [{ label: '⚠ Repository not found', value: '', disabled: true }];
    }
    return [{ label: `⚠ Could not load branches (${response.status})`, value: '', disabled: true }];
  }

  const branches = z
    .array(z.object({ name: z.string() }).passthrough())
    .parse(await response.json());

  // First item: "All branches" option (no filter)
  const items: DataSourceItem[] = [{ label: 'All Branches', value: '' }];

  for (const b of branches) {
    items.push({ label: b.name, value: b.name });
  }

  return items;
}

/**
 * Fetches deployment environments for a given repository.
 * Returns them as datasource items for the PI dropdown.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of environment items
 */
export async function fetchRepoEnvironments(
  owner: string,
  repo: string,
  token?: string,
): Promise<DataSourceItem[]> {
  const headers = buildHeaders(token);
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/environments`;

  const response = await fetchWithRetry(url, { headers }, 'fetchRepoEnvironments');

  if (!response.ok) {
    // 404 = no environments configured, 403 = no Environments permission
    if (response.status === 403) {
      return [
        { label: 'All Environments', value: '' },
        { label: '⚠ Token lacks Environments read permission', value: '', disabled: true },
      ];
    }
    return [{ label: 'All Environments', value: '' }];
  }

  const data = EnvironmentListResponseSchema.parse(await response.json());

  // First item: "All environments" option (no filter)
  const items: DataSourceItem[] = [{ label: 'All Environments', value: '' }];

  for (const env of data.environments) {
    items.push({ label: env.name, value: env.name });
  }

  return items;
}
