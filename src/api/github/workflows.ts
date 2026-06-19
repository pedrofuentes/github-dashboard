/**
 * CI/CD workflow status and dispatch functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z } from 'zod';

import {
  GITHUB_API_BASE,
  GitHubApiError,
  buildHeaders,
  fetchWithRetry,
  handleApiError,
  parseRateLimitHeaders,
  parseRetryAfter,
} from './core';
import {
  WorkflowRunsResponseSchema,
  DeploymentResponseSchema,
  DeploymentStatusResponseSchema,
} from './schemas';

/** Possible workflow run statuses from the GitHub API */
export type WorkflowRunStatus =
  | 'completed'
  | 'action_required'
  | 'cancelled'
  | 'failure'
  | 'neutral'
  | 'skipped'
  | 'stale'
  | 'success'
  | 'timed_out'
  | 'in_progress'
  | 'queued'
  | 'requested'
  | 'waiting'
  | 'pending';

/** Possible workflow run conclusions */
export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | null;

/** Possible deployment status states */
export type DeploymentState =
  | 'error'
  | 'failure'
  | 'inactive'
  | 'in_progress'
  | 'queued'
  | 'pending'
  | 'success';

/** Subset of workflow run data we care about */
export interface WorkflowRun {
  id: number;
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion;
  head_branch: string;
  event: string;
  display_title: string;
  run_number: number;
  html_url: string;
  created_at: string;
  updated_at: string;
}

/** Deployment status info */
export interface DeploymentStatus {
  id: number;
  state: DeploymentState;
  description: string;
  environment: string;
  created_at: string;
  log_url: string;
}

/** Combined workflow + deployment info for the button */
export interface WorkflowInfo {
  latestRun: WorkflowRun | null;
  deployment: DeploymentStatus | null;
}

/**
 * Fetches the latest workflow runs for a repository.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT (required for Actions read permission)
 * @param branch - Optional branch filter
 * @param workflowFile - Optional workflow file name (e.g. "deploy.yml")
 * @returns The most recent workflow run, or null if none found
 * @throws {GitHubApiError} on API errors
 */
export async function fetchLatestWorkflowRun(
  owner: string,
  repo: string,
  token?: string,
  branch?: string,
  workflowFile?: string,
): Promise<WorkflowRun | null> {
  let url: string;
  if (workflowFile) {
    url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=1`;
  } else {
    url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=1`;
  }

  if (branch) {
    url += `&branch=${encodeURIComponent(branch)}`;
  }

  const headers = buildHeaders(token);
  const response = await fetchWithRetry(url, { headers }, 'fetchLatestWorkflowRun');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const data = WorkflowRunsResponseSchema.parse(await response.json());
  const runs = data.workflow_runs;

  if (runs.length === 0) {
    return null;
  }

  const run = runs[0];
  return {
    id: run.id,
    name: run.name,
    status: (run.status as WorkflowRunStatus) ?? 'completed',
    conclusion: (run.conclusion as WorkflowRunConclusion) ?? null,
    head_branch: run.head_branch,
    event: run.event,
    display_title: run.display_title,
    run_number: run.run_number,
    html_url: run.html_url,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

/**
 * Fetches the latest deployment status for a repository.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @param environment - Optional environment filter (e.g. "production")
 * @returns Latest deployment status, or null if no deployments
 * @throws {GitHubApiError} on API errors
 */
export async function fetchLatestDeploymentStatus(
  owner: string,
  repo: string,
  token?: string,
  environment?: string,
): Promise<DeploymentStatus | null> {
  let url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments?per_page=1`;

  if (environment) {
    url += `&environment=${encodeURIComponent(environment)}`;
  }

  const headers = buildHeaders(token);
  const response = await fetchWithRetry(url, { headers }, 'fetchLatestDeploymentStatus');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const deployments = z.array(DeploymentResponseSchema).parse(await response.json());

  if (deployments.length === 0) {
    return null;
  }

  const deployment = deployments[0];
  const deploymentId = deployment.id;

  // Fetch the latest status for this deployment
  const statusUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments/${deploymentId}/statuses?per_page=1`;
  const statusResponse = await fetchWithRetry(
    statusUrl,
    { headers },
    'fetchLatestDeploymentStatus',
  );
  const statusRateLimitInfo = parseRateLimitHeaders(statusResponse.headers);

  if (!statusResponse.ok) {
    handleApiError(
      statusResponse.status,
      statusRateLimitInfo,
      owner,
      repo,
      parseRetryAfter(statusResponse.headers),
    );
  }

  const statuses = z.array(DeploymentStatusResponseSchema).parse(await statusResponse.json());

  if (statuses.length === 0) {
    return {
      id: deploymentId,
      state: 'pending',
      description: deployment.description ?? '',
      environment: deployment.environment,
      created_at: deployment.created_at,
      log_url: '',
    };
  }

  const status = statuses[0];
  return {
    id: deploymentId,
    state: (status.state as DeploymentState) ?? 'pending',
    description: status.description ?? '',
    environment: status.environment ?? deployment.environment,
    created_at: status.created_at,
    log_url: status.log_url ?? '',
  };
}

/**
 * Fetches combined workflow run + deployment info for a repository.
 */
export async function fetchWorkflowInfo(
  owner: string,
  repo: string,
  token?: string,
  options?: {
    branch?: string;
    workflowFile?: string;
    environment?: string;
  },
): Promise<WorkflowInfo> {
  // Fetch the primary workflow run — let errors propagate for proper error display.
  // Fetch the secondary deployment status — catch errors so partial results still work.
  const [latestRun, deployment] = await Promise.all([
    fetchLatestWorkflowRun(owner, repo, token, options?.branch, options?.workflowFile),
    fetchLatestDeploymentStatus(owner, repo, token, options?.environment).catch(() => null),
  ]);

  return { latestRun, deployment };
}

/**
 * Triggers a workflow dispatch event for the specified workflow.
 * Requires the token to have `Actions: Write` permission.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param workflowFile - Workflow filename (e.g., "deploy.yml")
 * @param ref - Branch or tag to run the workflow on
 * @param token - GitHub PAT with Actions write permission
 * @throws GitHubApiError if the request fails (e.g., 403 for missing permissions)
 */
export async function triggerWorkflowDispatch(
  owner: string,
  repo: string,
  workflowFile: string,
  ref: string,
  token: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
  const response = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    },
    'triggerWorkflowDispatch',
  );

  if (!response.ok) {
    const rateLimitInfo = parseRateLimitHeaders(response.headers);
    if (response.status === 403) {
      throw new GitHubApiError(
        'Workflow dispatch requires Actions: Write permission on your token',
        403,
        rateLimitInfo,
      );
    }
    throw new GitHubApiError(
      `Failed to trigger workflow dispatch: ${response.status}`,
      response.status,
      rateLimitInfo,
    );
  }
}

/**
 * Returns the effective display status string for a workflow run.
 */
export function getWorkflowDisplayStatus(run: WorkflowRun): string {
  if (run.status === 'completed') {
    return run.conclusion ?? 'completed';
  }
  return run.status;
}

/**
 * Returns a human-friendly label for a workflow status.
 */
export function getWorkflowStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    success: 'Success',
    failure: 'Failed',
    cancelled: 'Cancelled',
    skipped: 'Skipped',
    timed_out: 'Timed Out',
    action_required: 'Action Req.',
    neutral: 'Neutral',
    stale: 'Stale',
    in_progress: 'Running',
    queued: 'Queued',
    requested: 'Requested',
    waiting: 'Waiting',
    pending: 'Pending',
    completed: 'Completed',
  };
  return labels[status] ?? status;
}

/**
 * Formats a workflow run duration from created_at → updated_at.
 * Returns a compact duration string like "3m 42s", "1h 5m", or "" if unavailable.
 *
 * @param createdAt - ISO 8601 start time
 * @param updatedAt - ISO 8601 end time
 * @returns Formatted duration string or empty string
 */
export function formatRunDuration(createdAt: string, updatedAt: string): string {
  if (!createdAt || !updatedAt) return '';
  const start = new Date(createdAt).getTime();
  const end = new Date(updatedAt).getTime();
  const diffMs = end - start;
  if (diffMs <= 0 || isNaN(diffMs)) return '';

  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
