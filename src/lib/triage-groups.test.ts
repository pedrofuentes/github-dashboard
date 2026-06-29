import { describe, it, expect } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import {
  TRIAGE_BAND_LABELS,
  TRIAGE_BAND_ORDER,
  buildTriageModel,
  classifyTriageBand,
  hasExternalPr,
  hasFailingCi,
  hasIssuesOverThreshold,
  hasReviewRequest,
  hasSecurityRisk,
  hasSecurityWarning,
  hasStaleItems,
  type TriageBand,
} from './triage-groups';

const repo = (nameWithOwner: string): Repo => {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
};

const FAILING_CI: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
const SECURITY_RISK: RepoSignalData = { security: { status: 'ready', grade: 'D' } };
const ISSUES_OVER: RepoSignalData = {
  issues: { status: 'ready', openCount: 99, overThreshold: true },
};
const REVIEW_REQUESTED: RepoSignalData = { reviews: { status: 'ready', requestedCount: 2 } };
const EXTERNAL_PR: RepoSignalData = {
  pullRequests: { status: 'ready', openCount: 3, externalCount: 1 },
};
const STALE: RepoSignalData = { stale: { status: 'ready', staleCount: 4 } };
const SECURITY_WARNING: RepoSignalData = { security: { status: 'ready', grade: 'C' } };
const HEALTHY: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
  security: { status: 'ready', grade: 'A' },
  reviews: { status: 'ready', requestedCount: 0 },
  pullRequests: { status: 'ready', openCount: 0, externalCount: 0 },
  issues: { status: 'ready', openCount: 1, overThreshold: false },
  stale: { status: 'ready', staleCount: 0 },
};

function rowDataFor(map: Record<string, RepoSignalData>): GetRowData {
  return (r) => map[r.nameWithOwner] ?? {};
}

describe('triage-groups predicates', () => {
  it('hasFailingCi only when the CI slice is ready and failing', () => {
    expect(hasFailingCi(FAILING_CI)).toBe(true);
    expect(hasFailingCi({ ci: { status: 'ready', conclusion: 'success' } })).toBe(false);
    expect(hasFailingCi({ ci: { status: 'loading', conclusion: 'failure' } })).toBe(false);
    expect(hasFailingCi({})).toBe(false);
  });

  it('hasSecurityRisk only for ready D–F grades', () => {
    expect(hasSecurityRisk({ security: { status: 'ready', grade: 'D' } })).toBe(true);
    expect(hasSecurityRisk({ security: { status: 'ready', grade: 'F' } })).toBe(true);
    expect(hasSecurityRisk({ security: { status: 'ready', grade: 'C' } })).toBe(false);
    expect(hasSecurityRisk({ security: { status: 'loading', grade: 'F' } })).toBe(false);
    expect(hasSecurityRisk({})).toBe(false);
  });

  it('hasIssuesOverThreshold only when ready and over threshold', () => {
    expect(hasIssuesOverThreshold(ISSUES_OVER)).toBe(true);
    expect(hasIssuesOverThreshold({ issues: { status: 'ready', overThreshold: false } })).toBe(
      false,
    );
    expect(hasIssuesOverThreshold({ issues: { status: 'loading', overThreshold: true } })).toBe(
      false,
    );
  });

  it('hasReviewRequest only when ready with a positive count', () => {
    expect(hasReviewRequest(REVIEW_REQUESTED)).toBe(true);
    expect(hasReviewRequest({ reviews: { status: 'ready', requestedCount: 0 } })).toBe(false);
    expect(hasReviewRequest({ reviews: { status: 'loading', requestedCount: 5 } })).toBe(false);
  });

  it('hasExternalPr only when ready with a positive external count', () => {
    expect(hasExternalPr(EXTERNAL_PR)).toBe(true);
    expect(hasExternalPr({ pullRequests: { status: 'ready', externalCount: 0 } })).toBe(false);
    expect(hasExternalPr({ pullRequests: { status: 'loading', externalCount: 2 } })).toBe(false);
  });

  it('hasStaleItems only when ready with a positive stale count', () => {
    expect(hasStaleItems(STALE)).toBe(true);
    expect(hasStaleItems({ stale: { status: 'ready', staleCount: 0 } })).toBe(false);
    expect(hasStaleItems({ stale: { status: 'loading', staleCount: 9 } })).toBe(false);
  });

  it('hasSecurityWarning only for a ready C grade', () => {
    expect(hasSecurityWarning(SECURITY_WARNING)).toBe(true);
    expect(hasSecurityWarning({ security: { status: 'ready', grade: 'B' } })).toBe(false);
    expect(hasSecurityWarning({ security: { status: 'loading', grade: 'C' } })).toBe(false);
  });
});

describe('classifyTriageBand', () => {
  it('maps each signal to its band', () => {
    expect(classifyTriageBand(FAILING_CI)).toBe('needs-attention');
    expect(classifyTriageBand(SECURITY_RISK)).toBe('needs-attention');
    expect(classifyTriageBand(ISSUES_OVER)).toBe('needs-attention');
    expect(classifyTriageBand(REVIEW_REQUESTED)).toBe('waiting-on-me');
    expect(classifyTriageBand(EXTERNAL_PR)).toBe('community');
    expect(classifyTriageBand(STALE)).toBe('watch');
    expect(classifyTriageBand(SECURITY_WARNING)).toBe('watch');
    expect(classifyTriageBand(HEALTHY)).toBe('healthy');
    expect(classifyTriageBand({})).toBe('healthy');
  });

  it('places a repo in the HIGHEST applicable band (precedence + dedup)', () => {
    // Failing CI AND review-requested → Needs attention (not Waiting on me)
    expect(classifyTriageBand({ ...FAILING_CI, ...REVIEW_REQUESTED })).toBe('needs-attention');
    // Review-requested AND external PR → Waiting on me (not Community)
    expect(classifyTriageBand({ ...REVIEW_REQUESTED, ...EXTERNAL_PR })).toBe('waiting-on-me');
    // External PR AND stale → Community (not Watch)
    expect(classifyTriageBand({ ...EXTERNAL_PR, ...STALE })).toBe('community');
    // Stale AND C-security → Watch
    expect(classifyTriageBand({ ...STALE, ...SECURITY_WARNING })).toBe('watch');
  });
});

describe('TRIAGE_BAND_ORDER / labels', () => {
  it('is worst-first', () => {
    expect(TRIAGE_BAND_ORDER).toEqual([
      'needs-attention',
      'waiting-on-me',
      'community',
      'watch',
      'healthy',
    ]);
  });

  it('has a human label for every band', () => {
    for (const band of TRIAGE_BAND_ORDER) {
      expect(TRIAGE_BAND_LABELS[band as TriageBand]).toBeTruthy();
    }
  });
});

describe('buildTriageModel', () => {
  it('groups repos into bands, worst-first, omitting empty bands', () => {
    const repos = [
      repo('octo/broken'),
      repo('octo/review'),
      repo('octo/external'),
      repo('octo/watch'),
      repo('octo/healthy'),
    ];
    const model = buildTriageModel(
      repos,
      rowDataFor({
        'octo/broken': FAILING_CI,
        'octo/review': REVIEW_REQUESTED,
        'octo/external': EXTERNAL_PR,
        'octo/watch': STALE,
        'octo/healthy': HEALTHY,
      }),
    );

    expect(model.groups.map((g) => g.band)).toEqual([
      'needs-attention',
      'waiting-on-me',
      'community',
      'watch',
      'healthy',
    ]);
    expect(model.total).toBe(5);
    expect(model.counts).toEqual({
      'needs-attention': 1,
      'waiting-on-me': 1,
      community: 1,
      watch: 1,
      healthy: 1,
    });
    expect(model.allClear).toBe(false);
  });

  it('omits bands with no repos and preserves input order within a band', () => {
    const repos = [repo('octo/z'), repo('octo/a')];
    const model = buildTriageModel(
      repos,
      rowDataFor({ 'octo/z': FAILING_CI, 'octo/a': FAILING_CI }),
    );
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].band).toBe('needs-attention');
    expect(model.groups[0].repos.map((r) => r.nameWithOwner)).toEqual(['octo/z', 'octo/a']);
  });

  it('reports allClear when every repo is healthy', () => {
    const repos = [repo('octo/a'), repo('octo/b')];
    const model = buildTriageModel(repos, rowDataFor({ 'octo/a': HEALTHY, 'octo/b': HEALTHY }));
    expect(model.allClear).toBe(true);
    expect(model.counts.healthy).toBe(2);
  });

  it('is not allClear for an empty fleet', () => {
    const model = buildTriageModel([], rowDataFor({}));
    expect(model.allClear).toBe(false);
    expect(model.total).toBe(0);
    expect(model.groups).toHaveLength(0);
  });

  it('does not mutate the input repos array', () => {
    const repos = [repo('octo/broken'), repo('octo/healthy')];
    const snapshot = repos.map((r) => r.nameWithOwner);
    buildTriageModel(repos, rowDataFor({ 'octo/broken': FAILING_CI, 'octo/healthy': HEALTHY }));
    expect(repos.map((r) => r.nameWithOwner)).toEqual(snapshot);
  });
});
