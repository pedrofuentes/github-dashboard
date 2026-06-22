import { describe, expect, it } from 'vitest';

import type { RepoSignalData } from '../types/fleet';
import { classifyRepoHealth, perRepoHealth, summarizeFleetHealth } from './fleet-summary';

describe('classifyRepoHealth', () => {
  it('classifies a repo with failing CI as broken', () => {
    expect(classifyRepoHealth({ ci: { status: 'ready', conclusion: 'failure' } })).toBe('broken');
  });

  it('classifies a D–F security grade as broken', () => {
    for (const grade of ['D', 'E', 'F'] as const) {
      expect(classifyRepoHealth({ security: { status: 'ready', grade } })).toBe('broken');
    }
  });

  it('classifies an over-threshold issue backlog as broken', () => {
    expect(
      classifyRepoHealth({ issues: { status: 'ready', openCount: 99, overThreshold: true } }),
    ).toBe('broken');
  });

  it('lets broken take precedence over warning signals', () => {
    expect(
      classifyRepoHealth({
        ci: { status: 'ready', conclusion: 'failure' },
        stale: { status: 'ready', staleCount: 3 },
      }),
    ).toBe('broken');
  });

  it('classifies a C security grade as a warning', () => {
    expect(classifyRepoHealth({ security: { status: 'ready', grade: 'C' } })).toBe('warning');
  });

  it('classifies a pending review request as a warning', () => {
    expect(classifyRepoHealth({ reviews: { status: 'ready', requestedCount: 2 } })).toBe('warning');
  });

  it('classifies stale items as a warning', () => {
    expect(classifyRepoHealth({ stale: { status: 'ready', staleCount: 1 } })).toBe('warning');
  });

  it('classifies a clean, ready repo as healthy', () => {
    expect(
      classifyRepoHealth({
        ci: { status: 'ready', conclusion: 'success' },
        security: { status: 'ready', grade: 'A' },
        reviews: { status: 'ready', requestedCount: 0 },
        stale: { status: 'ready', staleCount: 0 },
        issues: { status: 'ready', openCount: 1, overThreshold: false },
      }),
    ).toBe('healthy');
  });

  it('treats an empty / unresolved repo as healthy (no attention signals yet)', () => {
    expect(classifyRepoHealth({})).toBe('healthy');
    expect(classifyRepoHealth({ ci: { status: 'loading' } })).toBe('healthy');
  });

  it('ignores non-ready slices when classifying (no premature broken/warning)', () => {
    // A grade only exists on a ready slice, but guard anyway against stray data.
    expect(classifyRepoHealth({ security: { status: 'loading', grade: 'F' } })).toBe('healthy');
    expect(classifyRepoHealth({ ci: { status: 'error', conclusion: 'failure' } })).toBe('healthy');
  });
});

describe('summarizeFleetHealth', () => {
  it('returns an all-zero summary for an empty fleet', () => {
    expect(summarizeFleetHealth([])).toEqual({
      total: 0,
      broken: 0,
      warning: 0,
      healthy: 0,
      failingCi: 0,
      securityRisk: 0,
      issuesOverThreshold: 0,
      staleRepos: 0,
      reviewRequested: 0,
    });
  });

  it('counts repos by health bucket', () => {
    const rows: RepoSignalData[] = [
      { ci: { status: 'ready', conclusion: 'failure' } }, // broken
      { security: { status: 'ready', grade: 'F' } }, // broken
      { stale: { status: 'ready', staleCount: 2 } }, // warning
      { security: { status: 'ready', grade: 'A' } }, // healthy
      {}, // healthy
    ];
    const summary = summarizeFleetHealth(rows);
    expect(summary.total).toBe(5);
    expect(summary.broken).toBe(2);
    expect(summary.warning).toBe(1);
    expect(summary.healthy).toBe(2);
  });

  it('rolls up per-signal counts and the total review-requested', () => {
    const rows: RepoSignalData[] = [
      {
        ci: { status: 'ready', conclusion: 'failure' },
        security: { status: 'ready', grade: 'D' },
        reviews: { status: 'ready', requestedCount: 3 },
        stale: { status: 'ready', staleCount: 1 },
        issues: { status: 'ready', openCount: 50, overThreshold: true },
      },
      {
        reviews: { status: 'ready', requestedCount: 2 },
      },
    ];
    const summary = summarizeFleetHealth(rows);
    expect(summary.failingCi).toBe(1);
    expect(summary.securityRisk).toBe(1);
    expect(summary.issuesOverThreshold).toBe(1);
    expect(summary.staleRepos).toBe(1);
    expect(summary.reviewRequested).toBe(5);
  });

  it('buckets a repo with multiple broken signals exactly once', () => {
    const rows: RepoSignalData[] = [
      {
        ci: { status: 'ready', conclusion: 'failure' },
        security: { status: 'ready', grade: 'D' },
      },
    ];
    const summary = summarizeFleetHealth(rows);
    expect(summary.total).toBe(1);
    expect(summary.broken).toBe(1);
    expect(summary.failingCi).toBe(1);
    expect(summary.securityRisk).toBe(1);
  });

  it('ignores a non-finite review/stale count (NaN never leaks into the rollup)', () => {
    const rows: RepoSignalData[] = [
      {
        reviews: { status: 'ready', requestedCount: Number.NaN },
        stale: { status: 'ready', staleCount: Number.NaN },
      },
    ];
    const summary = summarizeFleetHealth(rows);
    expect(summary.reviewRequested).toBe(0);
    expect(summary.staleRepos).toBe(0);
  });

  it('accepts any iterable of signal data (e.g. a Map values iterator)', () => {
    const map = new Map<string, RepoSignalData>([
      ['octo/a', { ci: { status: 'ready', conclusion: 'failure' } }],
      ['octo/b', {}],
    ]);
    const summary = summarizeFleetHealth(map.values());
    expect(summary.total).toBe(2);
    expect(summary.broken).toBe(1);
    expect(summary.healthy).toBe(1);
  });
});

describe('perRepoHealth', () => {
  it('returns an empty list for an empty fleet', () => {
    expect(perRepoHealth([])).toEqual([]);
    expect(perRepoHealth(new Map<string, RepoSignalData>().entries())).toEqual([]);
  });

  it('maps each [repo, data] pair to its classified health entry', () => {
    const rows: Array<readonly [string, RepoSignalData]> = [
      ['octo/broken', { ci: { status: 'ready', conclusion: 'failure' } }],
      ['octo/warning', { reviews: { status: 'ready', requestedCount: 2 } }],
      ['octo/healthy', { ci: { status: 'ready', conclusion: 'success' } }],
    ];
    expect(perRepoHealth(rows)).toEqual([
      { repo: 'octo/broken', health: 'broken' },
      { repo: 'octo/warning', health: 'warning' },
      { repo: 'octo/healthy', health: 'healthy' },
    ]);
  });

  it('reuses classifyRepoHealth precedence (broken outranks a warning signal)', () => {
    const rows: Array<readonly [string, RepoSignalData]> = [
      [
        'octo/mixed',
        {
          ci: { status: 'ready', conclusion: 'failure' },
          stale: { status: 'ready', staleCount: 4 },
        },
      ],
    ];
    expect(perRepoHealth(rows)).toEqual([{ repo: 'octo/mixed', health: 'broken' }]);
  });

  it('preserves the input order and keys by nameWithOwner', () => {
    const map = new Map<string, RepoSignalData>([
      ['octo/a', {}],
      ['octo/b', { security: { status: 'ready', grade: 'F' } }],
    ]);
    const entries = perRepoHealth(map.entries());
    expect(entries.map((entry) => entry.repo)).toEqual(['octo/a', 'octo/b']);
    expect(entries[1]).toEqual({ repo: 'octo/b', health: 'broken' });
  });
});
