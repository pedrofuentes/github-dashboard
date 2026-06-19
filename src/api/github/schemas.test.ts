/**
 * Tests for Zod schemas (src/utils/github-api/schemas.ts).
 *
 * Validates that each schema accepts valid data, allows extra fields
 * (passthrough), rejects missing required fields, and handles nullable
 * / optional fields correctly.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  RepoStatsResponseSchema,
  WorkflowRunSchema,
  WorkflowRunsResponseSchema,
  DeploymentResponseSchema,
  DeploymentStatusResponseSchema,
  SearchCountResponseSchema,
  ReviewSearchResponseSchema,
  ReleaseResponseSchema,
  DependabotAlertSchema,
  BranchComparisonResponseSchema,
  BranchListItemSchema,
  CommitActivityWeekSchema,
  UserResponseSchema,
  UserRepoResponseSchema,
  WorkflowListResponseSchema,
  EnvironmentListResponseSchema,
} from './schemas';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Asserts that parsing `data` with `schema` throws a ZodError. */
function expectParseFailure(schema: { parse: (d: unknown) => unknown }, data: unknown): void {
  expect(() => schema.parse(data)).toThrow(ZodError);
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

// ── RepoStatsResponseSchema ──────────────────────────

describe('RepoStatsResponseSchema', () => {
  const valid = {
    stargazers_count: 42,
    open_issues_count: 5,
    forks_count: 10,
    watchers_count: 42,
    full_name: 'owner/repo',
    description: 'A cool repo',
    visibility: 'public',
    html_url: 'https://github.com/owner/repo',
    language: 'TypeScript',
    size: 1024,
    license: { spdx_id: 'MIT' },
    default_branch: 'main',
  };

  it('parses valid data', () => {
    const result = RepoStatsResponseSchema.parse(valid);
    expect(result.stargazers_count).toBe(42);
    expect(result.license).toEqual({ spdx_id: 'MIT' });
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, archived: true, topics: ['sdk'] };
    const result = RepoStatsResponseSchema.parse(data);
    expect((result as Record<string, unknown>).archived).toBe(true);
  });

  it('accepts null description', () => {
    const result = RepoStatsResponseSchema.parse({ ...valid, description: null });
    expect(result.description).toBeNull();
  });

  it('accepts null language', () => {
    const result = RepoStatsResponseSchema.parse({ ...valid, language: null });
    expect(result.language).toBeNull();
  });

  it('accepts null license', () => {
    const result = RepoStatsResponseSchema.parse({ ...valid, license: null });
    expect(result.license).toBeNull();
  });

  it('accepts null spdx_id inside license', () => {
    const result = RepoStatsResponseSchema.parse({ ...valid, license: { spdx_id: null } });
    expect(result.license?.spdx_id).toBeNull();
  });

  it('rejects missing required fields', () => {
    expectParseFailure(RepoStatsResponseSchema, {});
    expectParseFailure(RepoStatsResponseSchema, { stargazers_count: 1 });
  });

  it('rejects wrong types', () => {
    expectParseFailure(RepoStatsResponseSchema, { ...valid, stargazers_count: 'not-a-number' });
  });
});

// ── WorkflowRunSchema ────────────────────────────────

describe('WorkflowRunSchema', () => {
  const valid = {
    id: 123,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    event: 'push',
    display_title: 'Fix tests',
    run_number: 42,
    html_url: 'https://github.com/owner/repo/actions/runs/123',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:05:00Z',
  };

  it('parses valid data', () => {
    const result = WorkflowRunSchema.parse(valid);
    expect(result.id).toBe(123);
    expect(result.conclusion).toBe('success');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, actor: { login: 'user' } };
    const result = WorkflowRunSchema.parse(data);
    expect((result as Record<string, unknown>).actor).toEqual({ login: 'user' });
  });

  it('accepts null conclusion', () => {
    const result = WorkflowRunSchema.parse({ ...valid, conclusion: null });
    expect(result.conclusion).toBeNull();
  });

  it('rejects missing required fields', () => {
    expectParseFailure(WorkflowRunSchema, {});
    expectParseFailure(WorkflowRunSchema, { id: 1 });
  });
});

// ── WorkflowRunsResponseSchema ───────────────────────

describe('WorkflowRunsResponseSchema', () => {
  const validRun = {
    id: 1,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    event: 'push',
    display_title: 'Build',
    run_number: 1,
    html_url: 'https://github.com/owner/repo/actions/runs/1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:05:00Z',
  };

  it('parses valid data with runs', () => {
    const result = WorkflowRunsResponseSchema.parse({
      total_count: 1,
      workflow_runs: [validRun],
    });
    expect(result.total_count).toBe(1);
    expect(result.workflow_runs).toHaveLength(1);
  });

  it('parses empty runs array', () => {
    const result = WorkflowRunsResponseSchema.parse({
      total_count: 0,
      workflow_runs: [],
    });
    expect(result.workflow_runs).toHaveLength(0);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { total_count: 0, workflow_runs: [], extra: true };
    const result = WorkflowRunsResponseSchema.parse(data);
    expect((result as Record<string, unknown>).extra).toBe(true);
  });

  it('rejects missing workflow_runs', () => {
    expectParseFailure(WorkflowRunsResponseSchema, { total_count: 0 });
  });
});

// ── DeploymentResponseSchema ─────────────────────────

describe('DeploymentResponseSchema', () => {
  const valid = {
    id: 456,
    environment: 'production',
    created_at: '2024-01-01T00:00:00Z',
  };

  it('parses valid data', () => {
    const result = DeploymentResponseSchema.parse(valid);
    expect(result.id).toBe(456);
    expect(result.environment).toBe('production');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, task: 'deploy' };
    const result = DeploymentResponseSchema.parse(data);
    expect((result as Record<string, unknown>).task).toBe('deploy');
  });

  it('accepts null description', () => {
    const result = DeploymentResponseSchema.parse({ ...valid, description: null });
    expect(result.description).toBeNull();
  });

  it('accepts missing description (optional)', () => {
    const result = DeploymentResponseSchema.parse(valid);
    expect(result.description).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expectParseFailure(DeploymentResponseSchema, {});
    expectParseFailure(DeploymentResponseSchema, { id: 1 });
  });
});

// ── DeploymentStatusResponseSchema ───────────────────

describe('DeploymentStatusResponseSchema', () => {
  const valid = {
    state: 'success',
    created_at: '2024-01-01T00:00:00Z',
  };

  it('parses valid data', () => {
    const result = DeploymentStatusResponseSchema.parse(valid);
    expect(result.state).toBe('success');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, id: 789 };
    const result = DeploymentStatusResponseSchema.parse(data);
    expect((result as Record<string, unknown>).id).toBe(789);
  });

  it('accepts optional description as null', () => {
    const result = DeploymentStatusResponseSchema.parse({ ...valid, description: null });
    expect(result.description).toBeNull();
  });

  it('accepts missing description', () => {
    const result = DeploymentStatusResponseSchema.parse(valid);
    expect(result.description).toBeUndefined();
  });

  it('accepts optional environment', () => {
    const result = DeploymentStatusResponseSchema.parse({ ...valid, environment: 'staging' });
    expect(result.environment).toBe('staging');
  });

  it('accepts missing environment', () => {
    const result = DeploymentStatusResponseSchema.parse(valid);
    expect(result.environment).toBeUndefined();
  });

  it('accepts optional log_url', () => {
    const result = DeploymentStatusResponseSchema.parse({
      ...valid,
      log_url: 'https://example.com/logs',
    });
    expect(result.log_url).toBe('https://example.com/logs');
  });

  it('accepts missing log_url', () => {
    const result = DeploymentStatusResponseSchema.parse(valid);
    expect(result.log_url).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expectParseFailure(DeploymentStatusResponseSchema, {});
    expectParseFailure(DeploymentStatusResponseSchema, { state: 'success' });
  });
});

// ── SearchCountResponseSchema ────────────────────────

describe('SearchCountResponseSchema', () => {
  it('parses valid data', () => {
    const result = SearchCountResponseSchema.parse({ total_count: 7 });
    expect(result.total_count).toBe(7);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { total_count: 0, items: [], incomplete_results: false };
    const result = SearchCountResponseSchema.parse(data);
    expect((result as Record<string, unknown>).items).toEqual([]);
  });

  it('rejects missing total_count', () => {
    expectParseFailure(SearchCountResponseSchema, {});
  });

  it('rejects wrong type', () => {
    expectParseFailure(SearchCountResponseSchema, { total_count: 'seven' });
  });
});

// ── ReviewSearchResponseSchema ───────────────────────

describe('ReviewSearchResponseSchema', () => {
  const validItem = {
    number: 42,
    title: 'Fix bug',
    html_url: 'https://github.com/owner/repo/pull/42',
    created_at: '2024-01-01T00:00:00Z',
    user: { login: 'octocat' },
  };

  it('parses valid data', () => {
    const result = ReviewSearchResponseSchema.parse({
      total_count: 1,
      items: [validItem],
    });
    expect(result.total_count).toBe(1);
    expect(result.items[0].number).toBe(42);
    expect(result.items[0].user?.login).toBe('octocat');
  });

  it('parses empty items', () => {
    const result = ReviewSearchResponseSchema.parse({ total_count: 0, items: [] });
    expect(result.items).toHaveLength(0);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { total_count: 0, items: [], incomplete_results: false };
    const result = ReviewSearchResponseSchema.parse(data);
    expect((result as Record<string, unknown>).incomplete_results).toBe(false);
  });

  it('accepts null user', () => {
    const item = { ...validItem, user: null };
    const result = ReviewSearchResponseSchema.parse({ total_count: 1, items: [item] });
    expect(result.items[0].user).toBeNull();
  });

  it('rejects missing required fields in items', () => {
    expectParseFailure(ReviewSearchResponseSchema, {
      total_count: 1,
      items: [{ number: 42 }],
    });
  });
});

// ── ReleaseResponseSchema ────────────────────────────

describe('ReleaseResponseSchema', () => {
  const valid = {
    tag_name: 'v1.0.0',
    name: 'Version 1.0',
    html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
    published_at: '2024-01-01T00:00:00Z',
    prerelease: false,
    draft: false,
  };

  it('parses valid data', () => {
    const result = ReleaseResponseSchema.parse(valid);
    expect(result.tag_name).toBe('v1.0.0');
    expect(result.prerelease).toBe(false);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, assets: [] };
    const result = ReleaseResponseSchema.parse(data);
    expect((result as Record<string, unknown>).assets).toEqual([]);
  });

  it('accepts null name', () => {
    const result = ReleaseResponseSchema.parse({ ...valid, name: null });
    expect(result.name).toBeNull();
  });

  it('accepts null published_at', () => {
    const result = ReleaseResponseSchema.parse({ ...valid, published_at: null });
    expect(result.published_at).toBeNull();
  });

  it('rejects missing required fields', () => {
    expectParseFailure(ReleaseResponseSchema, {});
    expectParseFailure(ReleaseResponseSchema, { tag_name: 'v1.0.0' });
  });
});

// ── DependabotAlertSchema ────────────────────────────

describe('DependabotAlertSchema', () => {
  it('parses with security_advisory present', () => {
    const result = DependabotAlertSchema.parse({
      security_advisory: { severity: 'high' },
    });
    expect(result.security_advisory?.severity).toBe('high');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { security_advisory: { severity: 'low' }, number: 1 };
    const result = DependabotAlertSchema.parse(data);
    expect((result as Record<string, unknown>).number).toBe(1);
  });

  it('accepts missing security_advisory (optional)', () => {
    const result = DependabotAlertSchema.parse({});
    expect(result.security_advisory).toBeUndefined();
  });

  it('accepts null severity inside security_advisory', () => {
    const result = DependabotAlertSchema.parse({
      security_advisory: { severity: null },
    });
    expect(result.security_advisory?.severity).toBeNull();
  });
});

// ── BranchComparisonResponseSchema ───────────────────

describe('BranchComparisonResponseSchema', () => {
  const valid = {
    ahead_by: 3,
    behind_by: 1,
    total_commits: 4,
    html_url: 'https://github.com/owner/repo/compare/main...feature',
    status: 'ahead',
  };

  it('parses valid data', () => {
    const result = BranchComparisonResponseSchema.parse(valid);
    expect(result.ahead_by).toBe(3);
    expect(result.status).toBe('ahead');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, commits: [] };
    const result = BranchComparisonResponseSchema.parse(data);
    expect((result as Record<string, unknown>).commits).toEqual([]);
  });

  it('rejects missing required fields', () => {
    expectParseFailure(BranchComparisonResponseSchema, {});
    expectParseFailure(BranchComparisonResponseSchema, { ahead_by: 3 });
  });
});

// ── BranchListItemSchema ─────────────────────────────

describe('BranchListItemSchema', () => {
  const valid = {
    name: 'main',
    commit: { sha: 'abc123' },
  };

  it('parses valid data', () => {
    const result = BranchListItemSchema.parse(valid);
    expect(result.name).toBe('main');
    expect(result.commit.sha).toBe('abc123');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, protected: true };
    const result = BranchListItemSchema.parse(data);
    expect((result as Record<string, unknown>).protected).toBe(true);
  });

  it('rejects missing commit', () => {
    expectParseFailure(BranchListItemSchema, { name: 'main' });
  });

  it('rejects missing name', () => {
    expectParseFailure(BranchListItemSchema, { commit: { sha: 'abc' } });
  });
});

// ── CommitActivityWeekSchema ─────────────────────────

describe('CommitActivityWeekSchema', () => {
  const valid = {
    total: 15,
    week: 1704067200,
    days: [0, 3, 5, 2, 1, 4, 0],
  };

  it('parses valid data', () => {
    const result = CommitActivityWeekSchema.parse(valid);
    expect(result.total).toBe(15);
    expect(result.days).toHaveLength(7);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, extra: 'field' };
    const result = CommitActivityWeekSchema.parse(data);
    expect((result as Record<string, unknown>).extra).toBe('field');
  });

  it('rejects missing required fields', () => {
    expectParseFailure(CommitActivityWeekSchema, {});
    expectParseFailure(CommitActivityWeekSchema, { total: 5 });
  });

  it('rejects non-array days', () => {
    expectParseFailure(CommitActivityWeekSchema, { ...valid, days: 'not-array' });
  });
});

// ── UserResponseSchema ───────────────────────────────

describe('UserResponseSchema', () => {
  it('parses valid data', () => {
    const result = UserResponseSchema.parse({ login: 'octocat' });
    expect(result.login).toBe('octocat');
  });

  it('allows extra fields (passthrough)', () => {
    const data = { login: 'octocat', id: 1, avatar_url: 'https://example.com' };
    const result = UserResponseSchema.parse(data);
    expect((result as Record<string, unknown>).id).toBe(1);
  });

  it('rejects missing login', () => {
    expectParseFailure(UserResponseSchema, {});
  });
});

// ── UserRepoResponseSchema ───────────────────────────

describe('UserRepoResponseSchema', () => {
  const valid = {
    full_name: 'owner/repo',
    private: false,
    description: 'A repo',
  };

  it('parses valid data', () => {
    const result = UserRepoResponseSchema.parse(valid);
    expect(result.full_name).toBe('owner/repo');
    expect(result.private).toBe(false);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { ...valid, fork: true };
    const result = UserRepoResponseSchema.parse(data);
    expect((result as Record<string, unknown>).fork).toBe(true);
  });

  it('accepts null description', () => {
    const result = UserRepoResponseSchema.parse({ ...valid, description: null });
    expect(result.description).toBeNull();
  });

  it('rejects missing required fields', () => {
    expectParseFailure(UserRepoResponseSchema, {});
    expectParseFailure(UserRepoResponseSchema, { full_name: 'owner/repo' });
  });
});

// ── WorkflowListResponseSchema ───────────────────────

describe('WorkflowListResponseSchema', () => {
  const validWorkflow = {
    id: 1,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    state: 'active',
  };

  it('parses valid data', () => {
    const result = WorkflowListResponseSchema.parse({
      total_count: 1,
      workflows: [validWorkflow],
    });
    expect(result.total_count).toBe(1);
    expect(result.workflows[0].name).toBe('CI');
  });

  it('parses empty workflows', () => {
    const result = WorkflowListResponseSchema.parse({
      total_count: 0,
      workflows: [],
    });
    expect(result.workflows).toHaveLength(0);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { total_count: 0, workflows: [], extra: true };
    const result = WorkflowListResponseSchema.parse(data);
    expect((result as Record<string, unknown>).extra).toBe(true);
  });

  it('rejects missing workflows', () => {
    expectParseFailure(WorkflowListResponseSchema, { total_count: 0 });
  });
});

// ── EnvironmentListResponseSchema ────────────────────

describe('EnvironmentListResponseSchema', () => {
  const validEnv = { name: 'production', id: 1 };

  it('parses valid data', () => {
    const result = EnvironmentListResponseSchema.parse({
      total_count: 1,
      environments: [validEnv],
    });
    expect(result.total_count).toBe(1);
    expect(result.environments[0].name).toBe('production');
  });

  it('parses empty environments', () => {
    const result = EnvironmentListResponseSchema.parse({
      total_count: 0,
      environments: [],
    });
    expect(result.environments).toHaveLength(0);
  });

  it('allows extra fields (passthrough)', () => {
    const data = { total_count: 0, environments: [], extra: 42 };
    const result = EnvironmentListResponseSchema.parse(data);
    expect((result as Record<string, unknown>).extra).toBe(42);
  });

  it('rejects missing environments', () => {
    expectParseFailure(EnvironmentListResponseSchema, { total_count: 0 });
  });
});
