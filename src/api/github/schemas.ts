/**
 * Zod schemas for GitHub API response validation.
 *
 * Each schema defines the minimum fields the plugin accesses, with
 * `.passthrough()` so unexpected extra fields from GitHub don't cause
 * parse failures. Grouped by the API module that consumes them.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z } from 'zod';

// ──────────────────────────────────────────────
// repos.ts
// ──────────────────────────────────────────────

/** Schema for a single GitHub repository (used by fetchRepoStats). */
export const RepoStatsResponseSchema = z
  .object({
    stargazers_count: z.number(),
    open_issues_count: z.number(),
    forks_count: z.number(),
    watchers_count: z.number(),
    full_name: z.string(),
    description: z.string().nullable(),
    visibility: z.string(),
    html_url: z.string(),
    language: z.string().nullable(),
    size: z.number(),
    license: z
      .object({
        spdx_id: z.string().nullable(),
      })
      .passthrough()
      .nullable(),
    default_branch: z.string(),
  })
  .passthrough();

// ──────────────────────────────────────────────
// workflows.ts
// ──────────────────────────────────────────────

/** Schema for a single workflow run object. */
export const WorkflowRunSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    head_branch: z.string(),
    event: z.string(),
    display_title: z.string(),
    run_number: z.number(),
    html_url: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

/** Schema for the workflow runs list endpoint response. */
export const WorkflowRunsResponseSchema = z
  .object({
    total_count: z.number(),
    workflow_runs: z.array(WorkflowRunSchema),
  })
  .passthrough();

/** Schema for a single deployment. */
export const DeploymentResponseSchema = z
  .object({
    id: z.number(),
    environment: z.string(),
    created_at: z.string(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

/** Schema for a single deployment status. */
export const DeploymentStatusResponseSchema = z
  .object({
    state: z.string(),
    created_at: z.string(),
    description: z.string().nullable().optional(),
    environment: z.string().optional(),
    log_url: z.string().optional(),
  })
  .passthrough();

// ──────────────────────────────────────────────
// pull-requests.ts / issues-releases.ts
// ──────────────────────────────────────────────

/** Schema for search endpoints that only need the total count. */
export const SearchCountResponseSchema = z
  .object({
    total_count: z.number(),
  })
  .passthrough();

/** Schema for the review-requested PR search response. */
export const ReviewSearchResponseSchema = z
  .object({
    total_count: z.number(),
    items: z.array(
      z
        .object({
          number: z.number(),
          title: z.string(),
          html_url: z.string(),
          created_at: z.string(),
          user: z
            .object({
              login: z.string(),
            })
            .passthrough()
            .nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Schema for a single GitHub release. */
export const ReleaseResponseSchema = z
  .object({
    tag_name: z.string(),
    name: z.string().nullable(),
    html_url: z.string(),
    published_at: z.string().nullable(),
    prerelease: z.boolean(),
    draft: z.boolean(),
  })
  .passthrough();

// ──────────────────────────────────────────────
// security-branches.ts
// ──────────────────────────────────────────────

/** Schema for a single Dependabot alert. */
export const DependabotAlertSchema = z
  .object({
    // Per-alert identity retained for the Notifications Inbox so a 304 refresh
    // can replay it (INBOX-2B, issue #216). Optional: minimal fixtures and any
    // unexpectedly-shaped alert simply yield no inbox row, never a parse error.
    number: z.number().optional(),
    html_url: z.string().optional(),
    created_at: z.string().optional(),
    security_advisory: z
      .object({
        severity: z.string().nullable(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Schema for the branch comparison endpoint response. */
export const BranchComparisonResponseSchema = z
  .object({
    ahead_by: z.number(),
    behind_by: z.number(),
    total_commits: z.number(),
    html_url: z.string(),
    status: z.string(),
  })
  .passthrough();

/** Schema for a single branch list item. */
export const BranchListItemSchema = z
  .object({
    name: z.string(),
    commit: z
      .object({
        sha: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

/** Schema for a single week of commit activity. */
export const CommitActivityWeekSchema = z
  .object({
    total: z.number(),
    week: z.number(),
    days: z.array(z.number()),
  })
  .passthrough();

/** Schema for a single commit list item (for network graph). */
export const CommitListItemSchema = z
  .object({
    sha: z.string(),
    parents: z.array(
      z
        .object({
          sha: z.string(),
        })
        .passthrough(),
    ),
    commit: z
      .object({
        message: z.string(),
        author: z
          .object({
            name: z.string(),
            date: z.string().optional(),
          })
          .passthrough()
          .nullable(),
        committer: z
          .object({
            name: z.string(),
            date: z.string().optional(),
          })
          .passthrough()
          .nullable(),
      })
      .passthrough(),
  })
  .passthrough();

/** Schema for a single tag list item (for network graph). */
export const TagListItemSchema = z
  .object({
    name: z.string(),
    commit: z
      .object({
        sha: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

// ──────────────────────────────────────────────
// datasources.ts / core.ts
// ──────────────────────────────────────────────

/** Schema for the authenticated user response (token validation). */
export const UserResponseSchema = z
  .object({
    login: z.string(),
  })
  .passthrough();

/** Schema for a single user repository in a list response. */
export const UserRepoResponseSchema = z
  .object({
    full_name: z.string(),
    private: z.boolean(),
    description: z.string().nullable(),
  })
  .passthrough();

/** Schema for the workflow list endpoint response (datasource dropdown). */
export const WorkflowListResponseSchema = z
  .object({
    total_count: z.number(),
    workflows: z.array(
      z
        .object({
          id: z.number(),
          name: z.string(),
          path: z.string(),
          state: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Schema for the environment list endpoint response (datasource dropdown). */
export const EnvironmentListResponseSchema = z
  .object({
    total_count: z.number(),
    environments: z.array(
      z
        .object({
          name: z.string(),
          id: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
