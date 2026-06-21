import { describe, expect, it } from 'vitest';

import type { RepoSignalData } from '../types/fleet';
import { resolveSalience } from './tile-salience';

const calm = {
  tier: 'calm',
  edgeTone: 'neutral',
  tint: false,
  glow: false,
  actionableTab: false,
} as const;

describe('resolveSalience', () => {
  describe('ci', () => {
    it('escalates a failing latest run to problem/failure with tint + glow', () => {
      const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
      expect(resolveSalience('ci', data)).toEqual({
        tier: 'problem',
        edgeTone: 'failure',
        tint: true,
        glow: true,
        actionableTab: false,
      });
    });

    it('stays calm for a successful latest run', () => {
      const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'success' } };
      expect(resolveSalience('ci', data)).toEqual(calm);
    });

    it('stays calm when there is no run', () => {
      const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'none' } };
      expect(resolveSalience('ci', data)).toEqual(calm);
    });

    it('stays calm while the ci slice is loading', () => {
      const data: RepoSignalData = { ci: { status: 'loading', conclusion: 'failure' } };
      expect(resolveSalience('ci', data)).toEqual(calm);
    });

    it('stays calm when the ci slice errored', () => {
      const data: RepoSignalData = { ci: { status: 'error', conclusion: 'failure' } };
      expect(resolveSalience('ci', data)).toEqual(calm);
    });

    it('stays calm when the ci slice is absent', () => {
      expect(resolveSalience('ci', {})).toEqual(calm);
    });
  });

  describe('security', () => {
    it('escalates a critical alert to problem/failure with tint + glow', () => {
      const data: RepoSignalData = {
        security: { status: 'ready', counts: { critical: 1, high: 0, medium: 0, low: 0 } },
      };
      expect(resolveSalience('security', data)).toEqual({
        tier: 'problem',
        edgeTone: 'failure',
        tint: true,
        glow: true,
        actionableTab: false,
      });
    });

    it('escalates a high-only alert set to problem/warning with tint + glow', () => {
      const data: RepoSignalData = {
        security: { status: 'ready', counts: { critical: 0, high: 2, medium: 0, low: 0 } },
      };
      expect(resolveSalience('security', data)).toEqual({
        tier: 'problem',
        edgeTone: 'warning',
        tint: true,
        glow: true,
        actionableTab: false,
      });
    });

    it('escalates a medium-only alert set to problem/warning', () => {
      const data: RepoSignalData = {
        security: { status: 'ready', counts: { critical: 0, high: 0, medium: 3, low: 0 } },
      };
      expect(resolveSalience('security', data)).toEqual({
        tier: 'problem',
        edgeTone: 'warning',
        tint: true,
        glow: true,
        actionableTab: false,
      });
    });

    it('stays calm for a clean repo (low only)', () => {
      const data: RepoSignalData = {
        security: { status: 'ready', counts: { critical: 0, high: 0, medium: 0, low: 4 } },
      };
      expect(resolveSalience('security', data)).toEqual(calm);
    });

    it('stays calm when counts are absent', () => {
      const data: RepoSignalData = { security: { status: 'ready' } };
      expect(resolveSalience('security', data)).toEqual(calm);
    });

    it('stays calm while the security slice is loading', () => {
      const data: RepoSignalData = {
        security: { status: 'loading', counts: { critical: 9, high: 0, medium: 0, low: 0 } },
      };
      expect(resolveSalience('security', data)).toEqual(calm);
    });
  });

  describe('reviews', () => {
    it('marks awaiting reviews as actionable/info with an actionable tab', () => {
      const data: RepoSignalData = { reviews: { status: 'ready', requestedCount: 2 } };
      expect(resolveSalience('reviews', data)).toEqual({
        tier: 'actionable',
        edgeTone: 'info',
        tint: false,
        glow: false,
        actionableTab: true,
      });
    });

    it('stays calm when no reviews are awaiting', () => {
      const data: RepoSignalData = { reviews: { status: 'ready', requestedCount: 0 } };
      expect(resolveSalience('reviews', data)).toEqual(calm);
    });

    it('stays calm while the reviews slice is loading', () => {
      const data: RepoSignalData = { reviews: { status: 'loading', requestedCount: 5 } };
      expect(resolveSalience('reviews', data)).toEqual(calm);
    });

    it('stays calm when the reviews slice is absent', () => {
      expect(resolveSalience('reviews', {})).toEqual(calm);
    });
  });

  describe('always-calm signals', () => {
    it('keeps pullRequests calm/neutral even when ready', () => {
      const data: RepoSignalData = {
        pullRequests: { status: 'ready', openCount: 9, externalCount: 3 },
      };
      expect(resolveSalience('pullRequests', data)).toEqual(calm);
    });

    it('keeps issues calm/neutral even when ready', () => {
      const data: RepoSignalData = {
        issues: { status: 'ready', openCount: 12, overThreshold: true },
      };
      expect(resolveSalience('issues', data)).toEqual(calm);
    });

    it('keeps stale calm/neutral even when ready', () => {
      const data: RepoSignalData = { stale: { status: 'ready', staleCount: 7 } };
      expect(resolveSalience('stale', data)).toEqual(calm);
    });

    it('keeps activity calm/neutral', () => {
      expect(resolveSalience('activity', {})).toEqual(calm);
    });
  });
});
