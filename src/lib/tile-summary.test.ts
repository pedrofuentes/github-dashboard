import { describe, expect, it } from 'vitest';

import type { RepoSignalData } from '../types/fleet';
import { signalHeroSummary } from './tile-summary';

const NOW = Date.parse('2026-06-21T00:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

describe('signalHeroSummary', () => {
  it('summarises a failing CI slice as "N failing"', () => {
    const data: RepoSignalData = {
      ci: { status: 'ready', conclusion: 'failure', failingCount: 2 },
    };
    expect(signalHeroSummary('ci', data, NOW)).toBe('2 failing');
  });

  it('falls back to a 1-failing count when CI reports failure without a count', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
    expect(signalHeroSummary('ci', data, NOW)).toBe('1 failing');
  });

  it('summarises a passing CI slice as "0 failing"', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'success' } };
    expect(signalHeroSummary('ci', data, NOW)).toBe('0 failing');
  });

  it('summarises Security by critical count when any critical alert exists', () => {
    const data: RepoSignalData = {
      security: { status: 'ready', counts: { critical: 2, high: 5, medium: 0, low: 1 } },
    };
    expect(signalHeroSummary('security', data, NOW)).toBe('2 critical');
  });

  it('summarises Security by total alerts when there are no criticals', () => {
    const data: RepoSignalData = {
      security: { status: 'ready', counts: { critical: 0, high: 3, medium: 2, low: 1 } },
    };
    expect(signalHeroSummary('security', data, NOW)).toBe('6 alerts');
  });

  it('singularises a lone Security alert', () => {
    const data: RepoSignalData = {
      security: { status: 'ready', counts: { critical: 0, high: 1, medium: 0, low: 0 } },
    };
    expect(signalHeroSummary('security', data, NOW)).toBe('1 alert');
  });

  it('summarises Reviews as "N awaiting review"', () => {
    const data: RepoSignalData = { reviews: { status: 'ready', requestedCount: 3 } };
    expect(signalHeroSummary('reviews', data, NOW)).toBe('3 awaiting review');
  });

  it('summarises Pull requests as "N open"', () => {
    const data: RepoSignalData = { pullRequests: { status: 'ready', openCount: 4 } };
    expect(signalHeroSummary('pullRequests', data, NOW)).toBe('4 open');
  });

  it('summarises Issues as "N open"', () => {
    const data: RepoSignalData = { issues: { status: 'ready', openCount: 7 } };
    expect(signalHeroSummary('issues', data, NOW)).toBe('7 open');
  });

  it('summarises Stale by the oldest item age in days', () => {
    const data: RepoSignalData = {
      stale: {
        status: 'ready',
        staleCount: 2,
        staleItems: [
          { type: 'pr', number: 1, title: 'a', html_url: 'u', updated_at: daysAgo(12) },
          { type: 'issue', number: 2, title: 'b', html_url: 'u', updated_at: daysAgo(34) },
        ],
      },
    };
    expect(signalHeroSummary('stale', data, NOW)).toBe('oldest 34d');
  });

  it('summarises Stale by count when no item timestamps are available', () => {
    const data: RepoSignalData = { stale: { status: 'ready', staleCount: 5 } };
    expect(signalHeroSummary('stale', data, NOW)).toBe('5 stale');
  });

  it('returns a scope+state phrase for Activity (no RepoSignalData slice)', () => {
    expect(signalHeroSummary('activity', {}, NOW)).toBe('recent activity');
  });

  it('reports a loading slice as "loading"', () => {
    expect(signalHeroSummary('ci', { ci: { status: 'loading' } }, NOW)).toBe('loading');
  });

  it('reports an errored slice as "unavailable"', () => {
    expect(signalHeroSummary('ci', { ci: { status: 'error' } }, NOW)).toBe('unavailable');
  });

  it('reports a missing slice as "no data"', () => {
    expect(signalHeroSummary('issues', {}, NOW)).toBe('no data');
  });
});
