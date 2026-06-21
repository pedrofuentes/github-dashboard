import { describe, expect, it } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../../types/fleet';
import { deriveInboxItems } from './derive';

function makeRepo(nameWithOwner: string, isPrivate = false): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate };
}

/** Build a `getRowData` that reads from a fixed map, defaulting to empty data. */
function fixtureGetRowData(rows: Map<string, RepoSignalData>): GetRowData {
  return (repo) => rows.get(repo.nameWithOwner) ?? {};
}

const HELLO = makeRepo('octocat/hello-world');

/** A single repo carrying exactly one of every enriched signal (one item each). */
function allFiveKindsRow(): RepoSignalData {
  return {
    ci: {
      status: 'ready',
      conclusion: 'failure',
      failingCount: 2,
      latestRunUrl: 'https://github.com/octocat/hello-world/actions/runs/9876543210',
      runId: 9876543210,
      updatedAt: '2024-03-10T10:00:00Z',
    },
    reviews: {
      status: 'ready',
      requestedCount: 1,
      requests: [
        {
          number: 42,
          title: 'Fix the flaky test',
          html_url: 'https://github.com/octocat/hello-world/pull/42',
          created_at: '2024-03-11T09:00:00Z',
          user_login: 'reviewer-bait',
        },
      ],
    },
    pullRequests: {
      status: 'ready',
      openCount: 3,
      externalCount: 1,
      externalPullRequests: [
        {
          number: 108,
          title: 'Add a shiny feature',
          html_url: 'https://github.com/octocat/hello-world/pull/108',
          created_at: '2024-03-12T08:00:00Z',
          user_login: 'newbie',
          author_association: 'FIRST_TIME_CONTRIBUTOR',
        },
      ],
    },
    security: {
      status: 'ready',
      grade: 'F',
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
      alerts: [
        {
          number: 7,
          type: 'dependabot',
          severity: 'critical',
          html_url: 'https://github.com/octocat/hello-world/security/dependabot/7',
          created_at: '2024-03-13T07:00:00Z',
        },
      ],
    },
    // A raw-count-only signal: must NEVER produce an item (AC-6).
    issues: { status: 'ready', openCount: 99, overThreshold: true },
    stale: {
      status: 'ready',
      staleCount: 1,
      staleItems: [
        {
          number: 13,
          title: 'Ancient unresolved issue',
          html_url: 'https://github.com/octocat/hello-world/issues/13',
          updated_at: '2024-01-01T00:00:00Z',
          type: 'issue',
        },
      ],
    },
  };
}

describe('deriveInboxItems — all five kinds with correct fields (AC-6)', () => {
  const rows = new Map([[HELLO.nameWithOwner, allFiveKindsRow()]]);
  const items = deriveInboxItems([HELLO], fixtureGetRowData(rows));
  const byKind = (kind: string) => items.find((item) => item.kind === kind);

  it('derives exactly one item per enriched signal (counts produce none)', () => {
    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(['ci', 'review', 'new-pr', 'security', 'stale']),
    );
  });

  it('ci → failing run id + updatedAt, accent-failure, no severity', () => {
    expect(byKind('ci')).toMatchObject({
      id: 'ci:octocat/hello-world:9876543210',
      kind: 'ci',
      title: 'CI failing',
      url: 'https://github.com/octocat/hello-world/actions/runs/9876543210',
      timestamp: '2024-03-10T10:00:00Z',
      accent: 'failure',
    });
    expect(byKind('ci')?.repo).toBe(HELLO);
    expect(byKind('ci')?.severity).toBeUndefined();
  });

  it('review → per-PR identity, created_at timestamp, accent-warning', () => {
    expect(byKind('review')).toMatchObject({
      id: 'review:octocat/hello-world:#42',
      kind: 'review',
      title: 'Fix the flaky test',
      url: 'https://github.com/octocat/hello-world/pull/42',
      timestamp: '2024-03-11T09:00:00Z',
      accent: 'warning',
    });
  });

  it('new-pr → external PR identity, created_at timestamp, accent-coral', () => {
    expect(byKind('new-pr')).toMatchObject({
      id: 'new-pr:octocat/hello-world:#108',
      kind: 'new-pr',
      title: 'Add a shiny feature',
      url: 'https://github.com/octocat/hello-world/pull/108',
      timestamp: '2024-03-12T08:00:00Z',
      accent: 'coral',
    });
  });

  it('security → per-alert identity with severity + accent from severity', () => {
    expect(byKind('security')).toMatchObject({
      id: 'security:octocat/hello-world:dependabot:7',
      kind: 'security',
      title: 'Critical Dependabot alert #7',
      url: 'https://github.com/octocat/hello-world/security/dependabot/7',
      timestamp: '2024-03-13T07:00:00Z',
      severity: 'critical',
      accent: 'failure',
    });
  });

  it('stale → item identity, updated_at timestamp, accent-warning', () => {
    expect(byKind('stale')).toMatchObject({
      id: 'stale:octocat/hello-world:issue:#13',
      kind: 'stale',
      title: 'Ancient unresolved issue',
      url: 'https://github.com/octocat/hello-world/issues/13',
      timestamp: '2024-01-01T00:00:00Z',
      accent: 'warning',
    });
  });
});

describe('security severity → accent + severity mapping (AC-6, §5)', () => {
  it('maps each severity to its accent token and carries the severity', () => {
    const repo = makeRepo('octocat/sec');
    const rows = new Map<string, RepoSignalData>([
      [
        repo.nameWithOwner,
        {
          security: {
            status: 'ready',
            alerts: [
              {
                number: 1,
                type: 'dependabot',
                severity: 'critical',
                html_url: 'https://github.com/octocat/sec/security/dependabot/1',
                created_at: '2024-05-01T00:00:00Z',
              },
              {
                number: 2,
                type: 'dependabot',
                severity: 'high',
                html_url: 'https://github.com/octocat/sec/security/dependabot/2',
                created_at: '2024-05-02T00:00:00Z',
              },
              {
                number: 3,
                type: 'code-scanning',
                severity: 'medium',
                html_url: 'https://github.com/octocat/sec/security/code-scanning/3',
                created_at: '2024-05-03T00:00:00Z',
              },
              {
                number: 4,
                type: 'code-scanning',
                severity: 'low',
                html_url: 'https://github.com/octocat/sec/security/code-scanning/4',
                created_at: '2024-05-04T00:00:00Z',
              },
            ],
          },
        },
      ],
    ]);

    const items = deriveInboxItems([repo], fixtureGetRowData(rows));
    const accentById = Object.fromEntries(items.map((item) => [item.id, item.accent]));
    const titleById = Object.fromEntries(items.map((item) => [item.id, item.title]));

    expect(accentById['security:octocat/sec:dependabot:1']).toBe('failure');
    expect(accentById['security:octocat/sec:dependabot:2']).toBe('warning');
    expect(accentById['security:octocat/sec:code-scanning:3']).toBe('info');
    expect(accentById['security:octocat/sec:code-scanning:4']).toBe('neutral');
    expect(titleById['security:octocat/sec:code-scanning:3']).toBe('Medium Code scanning alert #3');
  });
});

describe('ordering: newest-first by timestamp, tie-break by id (AC-7)', () => {
  it('orders strictly by descending timestamp regardless of kind', () => {
    const rows = new Map([[HELLO.nameWithOwner, allFiveKindsRow()]]);
    const items = deriveInboxItems([HELLO], fixtureGetRowData(rows));
    expect(items.map((item) => item.kind)).toEqual(['security', 'new-pr', 'review', 'ci', 'stale']);
  });

  it('breaks ties on equal timestamps by ascending id (a total order across >2 items)', () => {
    const tie = '2024-06-01T00:00:00Z';
    const ciRow = (nameWithOwner: string): RepoSignalData => ({
      ci: {
        status: 'ready',
        conclusion: 'failure',
        latestRunUrl: `https://github.com/${nameWithOwner}/actions/runs/1`,
        runId: 1,
        updatedAt: tie,
      },
    });
    const bbb = makeRepo('octocat/bbb');
    const aaa = makeRepo('octocat/aaa');
    const ccc = makeRepo('octocat/ccc');
    const rows = new Map<string, RepoSignalData>([
      [bbb.nameWithOwner, ciRow(bbb.nameWithOwner)],
      [aaa.nameWithOwner, ciRow(aaa.nameWithOwner)],
      [ccc.nameWithOwner, ciRow(ccc.nameWithOwner)],
    ]);

    // Shuffled input (bbb, aaa, ccc) must sort to ascending id regardless of
    // the comparison direction the sort happens to take.
    const items = deriveInboxItems([bbb, aaa, ccc], fixtureGetRowData(rows));
    expect(items.map((item) => item.id)).toEqual([
      'ci:octocat/aaa:1',
      'ci:octocat/bbb:1',
      'ci:octocat/ccc:1',
    ]);
  });

  it('is stable: identical input yields byte-identical output (no Date.now)', () => {
    const rows = new Map([[HELLO.nameWithOwner, allFiveKindsRow()]]);
    const getRowData = fixtureGetRowData(rows);
    const first = deriveInboxItems([HELLO], getRowData);
    const second = deriveInboxItems([HELLO], getRowData);
    expect(second).toEqual(first);
  });
});

describe('loading/error/unknown slices contribute nothing (AC-7, §2.3)', () => {
  it('skips a slice whose status is not "ready" even with full data', () => {
    const repo = makeRepo('octocat/pending');
    const rows = new Map<string, RepoSignalData>([
      [
        repo.nameWithOwner,
        {
          ci: {
            status: 'loading',
            conclusion: 'failure',
            latestRunUrl: 'https://github.com/octocat/pending/actions/runs/1',
            runId: 1,
            updatedAt: '2024-03-10T10:00:00Z',
          },
          reviews: {
            status: 'error',
            requests: [
              {
                number: 1,
                title: 'errored',
                html_url: 'https://github.com/octocat/pending/pull/1',
                created_at: '2024-03-11T09:00:00Z',
                user_login: 'x',
              },
            ],
          },
          security: {
            status: 'unknown',
            alerts: [
              {
                number: 1,
                type: 'dependabot',
                severity: 'critical',
                html_url: 'https://github.com/octocat/pending/security/dependabot/1',
                created_at: '2024-03-13T07:00:00Z',
              },
            ],
          },
        },
      ],
    ]);

    expect(deriveInboxItems([repo], fixtureGetRowData(rows))).toEqual([]);
  });

  it('skips a successful CI run and ready slices with no enriched list', () => {
    const repo = makeRepo('octocat/quiet');
    const rows = new Map<string, RepoSignalData>([
      [
        repo.nameWithOwner,
        {
          ci: {
            status: 'ready',
            conclusion: 'success',
            latestRunUrl: 'https://github.com/octocat/quiet/actions/runs/1',
            runId: 1,
            updatedAt: '2024-03-10T10:00:00Z',
          },
          reviews: { status: 'ready', requestedCount: 0 },
          pullRequests: { status: 'ready', openCount: 5, externalCount: 0 },
          security: { status: 'ready', grade: 'A' },
          stale: { status: 'ready', staleCount: 0 },
        },
      ],
    ]);

    expect(deriveInboxItems([repo], fixtureGetRowData(rows))).toEqual([]);
  });

  it('skips a failing CI run that is missing its run id (cannot build a stable id)', () => {
    const repo = makeRepo('octocat/no-run-id');
    const rows = new Map<string, RepoSignalData>([
      [
        repo.nameWithOwner,
        {
          ci: {
            status: 'ready',
            conclusion: 'failure',
            latestRunUrl: 'https://github.com/octocat/no-run-id/actions/runs/1',
            updatedAt: '2024-03-10T10:00:00Z',
          },
        },
      ],
    ]);

    expect(deriveInboxItems([repo], fixtureGetRowData(rows))).toEqual([]);
  });

  it('returns an empty list for an empty fleet', () => {
    expect(deriveInboxItems([], fixtureGetRowData(new Map()))).toEqual([]);
  });
});

describe('every url is GitHub-origin-gated via safeGitHubHref (AC-8)', () => {
  it('drops items whose url fails the GitHub-origin guard, keeps safe ones', () => {
    const repo = makeRepo('octocat/tampered');
    const rows = new Map<string, RepoSignalData>([
      [
        repo.nameWithOwner,
        {
          // Non-GitHub host → must be dropped, never emitted as a live link.
          ci: {
            status: 'ready',
            conclusion: 'failure',
            latestRunUrl: 'https://evil.com/octocat/tampered/actions/runs/5',
            runId: 5,
            updatedAt: '2024-07-01T00:00:00Z',
          },
          reviews: {
            status: 'ready',
            requests: [
              // Suffix-confusion lookalike → dropped.
              {
                number: 1,
                title: 'lookalike',
                html_url: 'https://github.com.evil.com/octocat/tampered/pull/1',
                created_at: '2024-07-02T00:00:00Z',
                user_login: 'x',
              },
              // Genuine GitHub link → kept.
              {
                number: 2,
                title: 'genuine',
                html_url: 'https://github.com/octocat/tampered/pull/2',
                created_at: '2024-07-03T00:00:00Z',
                user_login: 'y',
              },
            ],
          },
          pullRequests: {
            status: 'ready',
            externalPullRequests: [
              // javascript: scheme → dropped.
              {
                number: 9,
                title: 'xss',
                html_url: 'javascript:alert(1)',
                created_at: '2024-07-04T00:00:00Z',
                user_login: 'z',
                author_association: 'NONE',
              },
            ],
          },
        },
      ],
    ]);

    const items = deriveInboxItems([repo], fixtureGetRowData(rows));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'review:octocat/tampered:#2',
      url: 'https://github.com/octocat/tampered/pull/2',
    });
    // No emitted url is anything but a github.com origin.
    for (const item of items) {
      expect(item.url.startsWith('https://github.com/')).toBe(true);
    }
  });
});
