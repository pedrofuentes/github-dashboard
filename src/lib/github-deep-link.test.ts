import { describe, expect, it } from 'vitest';

import { isGitHubUrl } from './github-url';
import { signalDeepLinkUrl } from './github-deep-link';
import type { Repo, RepoSignalData } from '../types/fleet';

const REPO: Repo = {
  nameWithOwner: 'octo/repo',
  owner: 'octo',
  name: 'repo',
  isPrivate: false,
};

const EMPTY: RepoSignalData = {};

describe('signalDeepLinkUrl', () => {
  it('links the issues signal to the repo issues page', () => {
    expect(signalDeepLinkUrl(REPO, 'issues', EMPTY)).toBe('https://github.com/octo/repo/issues');
  });

  it('links the pull-requests signal to the repo pulls page', () => {
    expect(signalDeepLinkUrl(REPO, 'pullRequests', EMPTY)).toBe(
      'https://github.com/octo/repo/pulls',
    );
  });

  it('links the security signal to the repo security tab', () => {
    expect(signalDeepLinkUrl(REPO, 'security', EMPTY)).toBe(
      'https://github.com/octo/repo/security',
    );
  });

  it('links the reviews signal to the review-requested PR filter', () => {
    expect(signalDeepLinkUrl(REPO, 'reviews', EMPTY)).toBe(
      'https://github.com/octo/repo/pulls?q=is%3Aopen+is%3Apr+review-requested%3A%40me',
    );
  });

  it('links the stale signal to the oldest-updated open issues filter', () => {
    expect(signalDeepLinkUrl(REPO, 'stale', EMPTY)).toBe(
      'https://github.com/octo/repo/issues?q=is%3Aopen+sort%3Aupdated-asc',
    );
  });

  it('links the activity signal to the repo commit history', () => {
    expect(signalDeepLinkUrl(REPO, 'activity', EMPTY)).toBe('https://github.com/octo/repo/commits');
  });

  it('links the CI signal to the latest run when one is present and safe', () => {
    const data: RepoSignalData = {
      ci: {
        status: 'ready',
        conclusion: 'failure',
        latestRunUrl: 'https://github.com/octo/repo/actions/runs/42',
      },
    };
    expect(signalDeepLinkUrl(REPO, 'ci', data)).toBe(
      'https://github.com/octo/repo/actions/runs/42',
    );
  });

  it('falls back to the Actions tab when CI has no latest run URL', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'success' } };
    expect(signalDeepLinkUrl(REPO, 'ci', data)).toBe('https://github.com/octo/repo/actions');
  });

  it('falls back to the Actions tab when the CI latest run URL is off-origin', () => {
    const data: RepoSignalData = {
      ci: {
        status: 'ready',
        conclusion: 'failure',
        latestRunUrl: 'https://evil.example.com/octo/repo/runs/42',
      },
    };
    expect(signalDeepLinkUrl(REPO, 'ci', data)).toBe('https://github.com/octo/repo/actions');
  });

  it('only ever returns origin-guarded GitHub URLs', () => {
    const signals = [
      'ci',
      'security',
      'reviews',
      'pullRequests',
      'issues',
      'stale',
      'activity',
    ] as const;
    for (const signal of signals) {
      const url = signalDeepLinkUrl(REPO, signal, EMPTY);
      expect(url).toBeDefined();
      expect(isGitHubUrl(url as string)).toBe(true);
    }
  });
});
