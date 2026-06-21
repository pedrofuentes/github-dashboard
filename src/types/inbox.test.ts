import { describe, expect, it } from 'vitest';

import { buildReviewId, isInboxId } from '../lib/inbox/ids';
import type { Repo } from './fleet';
import type { InboxItem, InboxKind, InboxSeverity } from './inbox';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

describe('InboxItem model — §2.1', () => {
  it('models a review item with a stable id and no severity', () => {
    const item: InboxItem = {
      id: buildReviewId(repo.nameWithOwner, 42),
      kind: 'review',
      repo,
      title: 'Awaiting your review — Fix the thing',
      url: 'https://github.com/octocat/hello-world/pull/42',
      timestamp: '2024-01-01T00:00:00Z',
      accent: 'warning',
    };

    expect(item.severity).toBeUndefined();
    expect(item.kind).toBe('review');
    expect(item.repo.nameWithOwner).toBe('octocat/hello-world');
    expect(isInboxId(item.id)).toBe(true);
  });

  it('models a security item carrying an optional severity', () => {
    const item: InboxItem = {
      id: 'security:octocat/hello-world:dependabot:7',
      kind: 'security',
      repo,
      title: 'Critical advisory in a dependency',
      url: 'https://github.com/octocat/hello-world/security/dependabot/7',
      timestamp: '2024-01-01T00:00:00Z',
      severity: 'critical',
      accent: 'failure',
    };

    expect(item.severity).toBe('critical');
    expect(isInboxId(item.id)).toBe(true);
  });

  it('enumerates the five inbox kinds and four severities', () => {
    const kinds: InboxKind[] = ['ci', 'review', 'new-pr', 'security', 'stale'];
    const severities: InboxSeverity[] = ['critical', 'high', 'medium', 'low'];

    expect(new Set(kinds).size).toBe(5);
    expect(new Set(severities).size).toBe(4);
  });
});
