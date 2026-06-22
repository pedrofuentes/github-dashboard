import { describe, expect, it } from 'vitest';

import {
  buildCiId,
  buildNewPrId,
  buildReviewId,
  buildSecurityId,
  buildStaleId,
  isInboxId,
  parseInboxId,
} from './ids';
import type { SecurityAlertType, StaleTarget } from './ids';

const REPO = 'octocat/hello-world';

describe('stable-ID builders — §2.2 grammar (AC-1)', () => {
  it('buildCiId → ci:<repo>:<run-id>', () => {
    expect(buildCiId(REPO, 9876543210)).toBe('ci:octocat/hello-world:9876543210');
  });

  it('buildReviewId → review:<repo>:#<pr-number>', () => {
    expect(buildReviewId(REPO, 42)).toBe('review:octocat/hello-world:#42');
  });

  it('buildNewPrId → new-pr:<repo>:#<pr-number>', () => {
    expect(buildNewPrId(REPO, 108)).toBe('new-pr:octocat/hello-world:#108');
  });

  it('buildSecurityId → security:<repo>:<type>:<alert-number>', () => {
    expect(buildSecurityId(REPO, 'dependabot', 7)).toBe(
      'security:octocat/hello-world:dependabot:7',
    );
    expect(buildSecurityId(REPO, 'code-scanning', 3)).toBe(
      'security:octocat/hello-world:code-scanning:3',
    );
  });

  it('buildStaleId → stale:<repo>:<pr|issue>:#<number>', () => {
    expect(buildStaleId(REPO, 'issue', 13)).toBe('stale:octocat/hello-world:issue:#13');
    expect(buildStaleId(REPO, 'pr', 99)).toBe('stale:octocat/hello-world:pr:#99');
  });

  it('accepts a string run-id (e.g. parsed from the run URL path segment)', () => {
    expect(buildCiId(REPO, '9876543210')).toBe('ci:octocat/hello-world:9876543210');
  });

  it('every builder output is recognised by isInboxId', () => {
    expect(isInboxId(buildCiId(REPO, 1))).toBe(true);
    expect(isInboxId(buildReviewId(REPO, 1))).toBe(true);
    expect(isInboxId(buildNewPrId(REPO, 1))).toBe(true);
    expect(isInboxId(buildSecurityId(REPO, 'dependabot', 1))).toBe(true);
    expect(isInboxId(buildStaleId(REPO, 'issue', 1))).toBe(true);
  });
});

describe('parseInboxId / isInboxId — round-trip, rejection, collisions (AC-2)', () => {
  it('parseInboxId round-trips every kind back to its components', () => {
    expect(parseInboxId(buildCiId(REPO, 9876543210))).toEqual({
      kind: 'ci',
      repo: REPO,
      runId: '9876543210',
    });
    expect(parseInboxId(buildReviewId(REPO, 42))).toEqual({
      kind: 'review',
      repo: REPO,
      prNumber: 42,
    });
    expect(parseInboxId(buildNewPrId(REPO, 108))).toEqual({
      kind: 'new-pr',
      repo: REPO,
      prNumber: 108,
    });
    expect(parseInboxId(buildSecurityId(REPO, 'dependabot', 7))).toEqual({
      kind: 'security',
      repo: REPO,
      type: 'dependabot',
      alertNumber: 7,
    });
    expect(parseInboxId(buildStaleId(REPO, 'issue', 13))).toEqual({
      kind: 'stale',
      repo: REPO,
      target: 'issue',
      itemNumber: 13,
    });
  });

  it('re-building from a parsed id yields the identical string (full round-trip)', () => {
    const id = buildSecurityId(REPO, 'code-scanning', 3);
    const parsed = parseInboxId(id);
    expect(parsed).not.toBeNull();
    if (parsed?.kind === 'security') {
      expect(buildSecurityId(parsed.repo, parsed.type, parsed.alertNumber)).toBe(id);
    }
  });

  it('parseInboxId returns null for malformed ids', () => {
    const malformed = [
      '',
      'octocat/hello-world',
      'ci:octocat/hello-world',
      'ci:octocat/hello-world:',
      'ci:octocat/hello-world:abc',
      'review:octocat/hello-world:42',
      'review:octocat/hello-world:#',
      'new-pr:octocat/hello-world:#1.2',
      'security:octocat/hello-world:snyk:7',
      'security:octocat/hello-world:dependabot',
      'stale:octocat/hello-world:branch:#1',
      'stale:octocat/hello-world:issue:13',
      'unknown:octocat/hello-world:1',
      'ci:octocat:1',
      'ci:octo/cat/extra:1',
      'ci:octo:cat:1',
    ];
    for (const bad of malformed) {
      expect(parseInboxId(bad)).toBeNull();
    }
  });

  it('isInboxId accepts well-formed ids and rejects malformed values and non-strings', () => {
    expect(isInboxId('ci:octocat/hello-world:1')).toBe(true);
    expect(isInboxId('nope')).toBe(false);
    expect(isInboxId('')).toBe(false);
    expect(isInboxId(null)).toBe(false);
    expect(isInboxId(undefined)).toBe(false);
    expect(isInboxId(42)).toBe(false);
    expect(isInboxId({ id: 'ci:octocat/hello-world:1' })).toBe(false);
  });

  it('isInboxId rejects the full malformed corpus and every non-string (mutation-resistant, #224)', () => {
    // Drive the malformed corpus straight through `isInboxId` (not only via
    // `parseInboxId`) so a future wrapper rewrite that drops the parse check is
    // caught here. Mirrors the `parseInboxId` rejection corpus above.
    const malformed = [
      '',
      'octocat/hello-world',
      'ci:octocat/hello-world',
      'ci:octocat/hello-world:',
      'ci:octocat/hello-world:abc',
      'review:octocat/hello-world:42',
      'review:octocat/hello-world:#',
      'new-pr:octocat/hello-world:#1.2',
      'security:octocat/hello-world:snyk:7',
      'security:octocat/hello-world:dependabot',
      'stale:octocat/hello-world:branch:#1',
      'stale:octocat/hello-world:issue:13',
      'unknown:octocat/hello-world:1',
      'ci:octocat:1',
      'ci:octo/cat/extra:1',
      'ci:octo:cat:1',
    ];
    for (const bad of malformed) {
      expect(isInboxId(bad)).toBe(false);
    }

    // Non-strings are rejected by the `typeof` guard. The toString-spoofing
    // object would coerce to a *valid* id string, so it pins the guard: dropping
    // the `typeof` check would let it through.
    const nonStrings: unknown[] = [
      null,
      undefined,
      42,
      0,
      Number.NaN,
      true,
      false,
      {},
      [],
      ['ci:octocat/hello-world:1'],
      () => 'ci:octocat/hello-world:1',
      { toString: () => 'ci:octocat/hello-world:1' },
    ];
    for (const value of nonStrings) {
      expect(isInboxId(value)).toBe(false);
    }

    // A well-formed id of every kind is still accepted (the guard is not a blanket reject).
    for (const good of [
      buildCiId(REPO, 1),
      buildReviewId(REPO, 1),
      buildNewPrId(REPO, 1),
      buildSecurityId(REPO, 'dependabot', 1),
      buildStaleId(REPO, 'issue', 1),
    ]) {
      expect(isInboxId(good)).toBe(true);
    }
  });

  it('ids are collision-free across kinds for an identical repo + number', () => {
    const n = 42;
    const ids = [
      buildCiId(REPO, n),
      buildReviewId(REPO, n),
      buildNewPrId(REPO, n),
      buildSecurityId(REPO, 'dependabot', n),
      buildStaleId(REPO, 'issue', n),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseInboxId(buildCiId(REPO, n))?.kind).toBe('ci');
    expect(parseInboxId(buildReviewId(REPO, n))?.kind).toBe('review');
    expect(parseInboxId(buildNewPrId(REPO, n))?.kind).toBe('new-pr');
    expect(parseInboxId(buildSecurityId(REPO, 'dependabot', n))?.kind).toBe('security');
    expect(parseInboxId(buildStaleId(REPO, 'issue', n))?.kind).toBe('stale');
  });

  it('review and new-pr ids for the same PR are distinct (emitted as two items, never deduped)', () => {
    expect(buildReviewId(REPO, 42)).not.toBe(buildNewPrId(REPO, 42));
  });
});

describe('builders are pure and deterministic (AC-3)', () => {
  it('identical inputs yield byte-identical ids', () => {
    expect(buildCiId(REPO, 9876543210)).toBe(buildCiId(REPO, 9876543210));
    expect(buildReviewId(REPO, 42)).toBe(buildReviewId(REPO, 42));
    expect(buildSecurityId(REPO, 'dependabot', 7)).toBe(buildSecurityId(REPO, 'dependabot', 7));
    expect(buildStaleId(REPO, 'pr', 99)).toBe(buildStaleId(REPO, 'pr', 99));
  });

  it('normalises a numeric and string run-id to the same id', () => {
    expect(buildCiId(REPO, 9876543210)).toBe(buildCiId(REPO, '9876543210'));
  });
});

describe('builders validate inputs so output is always a valid id (grammar integrity)', () => {
  it('throws when repo is not "owner/name"', () => {
    expect(() => buildCiId('octocat', 1)).toThrow();
    expect(() => buildCiId('octo/cat/extra', 1)).toThrow();
    expect(() => buildReviewId('octo:cat', 1)).toThrow();
    expect(() => buildNewPrId('bad#repo/name', 1)).toThrow();
  });

  it('throws when a numeric id is not a non-negative integer', () => {
    expect(() => buildReviewId(REPO, -1)).toThrow();
    expect(() => buildReviewId(REPO, 1.5)).toThrow();
    expect(() => buildReviewId(REPO, Number.NaN)).toThrow();
    expect(() => buildCiId(REPO, 'abc')).toThrow();
    expect(() => buildCiId(REPO, '')).toThrow();
  });

  it('rejects a numeric id beyond Number.MAX_SAFE_INTEGER (would stringify to exponential, #226)', () => {
    // `String(1e21) === '1e+21'`, which would not round-trip through the §2.2
    // digit grammar; reject before it can mint a malformed id.
    expect(() => buildCiId(REPO, 1e21)).toThrow();
    expect(() => buildReviewId(REPO, 1e21)).toThrow();
    expect(() => buildNewPrId(REPO, 1e21)).toThrow();
    expect(() => buildSecurityId(REPO, 'dependabot', 1e21)).toThrow();
    expect(() => buildStaleId(REPO, 'pr', 1e21)).toThrow();
    expect(() => buildReviewId(REPO, Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => buildCiId(REPO, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('still accepts the largest safe integer run id (stringifies to plain digits, #226)', () => {
    const safe = Number.MAX_SAFE_INTEGER;
    expect(buildCiId(REPO, safe)).toBe(`ci:${REPO}:${safe}`);
    expect(parseInboxId(buildCiId(REPO, safe))).toEqual({
      kind: 'ci',
      repo: REPO,
      runId: String(safe),
    });
  });

  it('rejects an out-of-grammar enum segment in the security/stale builders (defensive, #225)', () => {
    // The enum segments are compile-time string-literal unions, but the builders
    // assert them too so an internal mis-call can never mint an off-grammar id.
    expect(() => buildSecurityId(REPO, 'snyk' as SecurityAlertType, 1)).toThrow();
    expect(() => buildSecurityId(REPO, '' as SecurityAlertType, 1)).toThrow();
    expect(() => buildStaleId(REPO, 'branch' as StaleTarget, 1)).toThrow();
    expect(() => buildStaleId(REPO, '' as StaleTarget, 1)).toThrow();
  });
});
