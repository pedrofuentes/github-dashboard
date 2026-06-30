import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AccentTone } from '../../components/tiles/types';
import type { RepoSignalData } from '../../types/fleet';
import { parseColorTokens } from '../css-tokens';
import {
  BOARD_KEY_ACCENT_VAR,
  boardKeyAccentVar,
  boardKeySpec,
  formatCount,
} from './board-key-spec';

describe('formatCount (SD design-spec §4.1)', () => {
  it('returns values below 1000 unchanged', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands with a "k" suffix and strips trailing zeros', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(47100)).toBe('47.1k');
    expect(formatCount(228000)).toBe('228k');
  });

  it('abbreviates millions with an "M" suffix', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(1_234_567)).toBe('1.2M');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });

  it('abbreviates billions with a "B" suffix', () => {
    expect(formatCount(1_000_000_000)).toBe('1B');
    expect(formatCount(2_500_000_000)).toBe('2.5B');
  });

  it('prefixes negatives with a minus sign (recursive on the magnitude)', () => {
    expect(formatCount(-42)).toBe('-42');
    expect(formatCount(-1500)).toBe('-1.5k');
    expect(formatCount(-228000)).toBe('-228k');
    expect(formatCount(-1_000_000)).toBe('-1M');
  });

  it('rounds at the 1-decimal boundary exactly as the spec formula does', () => {
    // 999999 / 1000 = 999.999 → toFixed(1) = "1000.0" → "1000k" (spec artifact, locked).
    expect(formatCount(999_999)).toBe('1000k');
  });

  it('returns "0" for NaN and Infinity inputs (defensive guard, #485)', () => {
    expect(formatCount(NaN)).toBe('0');
    expect(formatCount(Infinity)).toBe('0');
    expect(formatCount(-Infinity)).toBe('0');
  });
});

describe('BOARD_KEY_ACCENT_VAR', () => {
  const EXPECTED: Record<AccentTone, string> = {
    success: 'var(--color-success)',
    failure: 'var(--color-failure)',
    warning: 'var(--color-warning)',
    info: 'var(--color-info)',
    neutral: 'var(--color-neutral)',
    coral: 'var(--color-coral)',
    purple: 'var(--color-purple)',
    gold: 'var(--color-gold)',
    ochre: 'var(--color-ochre)',
  };

  it('maps every accent tone to its theme-aware var(--color-*) reference', () => {
    expect(BOARD_KEY_ACCENT_VAR).toEqual(EXPECTED);
  });

  it('references only custom properties defined in BOTH themes (no raw hex, no drift)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(resolve(here, '../../index.css'), 'utf8');
    const light = parseColorTokens(css, ':root');
    const dark = parseColorTokens(css, '.dark');

    for (const ref of Object.values(BOARD_KEY_ACCENT_VAR)) {
      expect(ref).toMatch(/^var\(--color-[\w-]+\)$/);
      const name = ref.slice('var('.length, -1);
      expect(light[name], `${name} missing from :root`).toBeDefined();
      expect(dark[name], `${name} missing from .dark`).toBeDefined();
    }
  });

  // Removed: runtime fallback test moved to boardKeyAccentVar function tests
});

describe('boardKeyAccentVar (defensive wrapper, #482)', () => {
  it('returns the var reference for valid tones', () => {
    const result = boardKeyAccentVar('success');
    expect(result).toBe('var(--color-success)');
  });

  it('returns neutral fallback for undefined keys', () => {
    const invalidKey = 'nonexistent' as AccentTone;
    const result = boardKeyAccentVar(invalidKey);
    expect(result).toBe('var(--color-neutral)');
  });
});

describe('boardKeySpec — ci (icon layout)', () => {
  it('maps a successful run to a success status icon', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'success' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'ready',
      layout: 'icon',
      accent: 'success',
      line2: '',
      line3: 'Success',
      status: 'success',
    });
  });

  it('maps a failing run to a failure status icon', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'ready',
      layout: 'icon',
      accent: 'failure',
      line2: '',
      line3: 'Failed',
      status: 'failure',
    });
  });

  it('maps an in-progress run to a warning accent (§7 amber)', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'in_progress' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'ready',
      layout: 'icon',
      accent: 'warning',
      line2: '',
      line3: 'Running',
      status: 'in_progress',
    });
  });

  it('maps a queued run to an info accent (§7 blue)', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'queued' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'ready',
      layout: 'icon',
      accent: 'info',
      line2: '',
      line3: 'Queued',
      status: 'queued',
    });
  });

  it('maps a "none" conclusion to a neutral status', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'none' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'ready',
      layout: 'icon',
      accent: 'neutral',
      line2: '',
      line3: 'Neutral',
      status: 'neutral',
    });
  });

  it('treats a ready run with no conclusion as neutral', () => {
    const data: RepoSignalData = { ci: { status: 'ready' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'ready',
      layout: 'icon',
      accent: 'neutral',
      line2: '',
      line3: 'Neutral',
      status: 'neutral',
    });
  });

  it('renders a loading ci slice as the loading state (icon layout, no status)', () => {
    const data: RepoSignalData = { ci: { status: 'loading' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'loading',
      layout: 'icon',
      accent: 'neutral',
      line2: '',
      line3: 'Loading',
    });
  });

  it('renders an errored ci slice as the error state with a non-failure accent', () => {
    const data: RepoSignalData = { ci: { status: 'error' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'error',
      layout: 'icon',
      accent: 'warning',
      line2: '',
      line3: 'Error',
    });
  });

  it('renders an unknown ci slice as the empty "No Runs" state', () => {
    const data: RepoSignalData = { ci: { status: 'unknown' } };
    expect(boardKeySpec('ci', data)).toEqual({
      state: 'empty',
      layout: 'icon',
      accent: 'neutral',
      line2: '',
      line3: 'No Runs',
    });
  });

  it('renders an absent ci slice as the empty state', () => {
    expect(boardKeySpec('ci', {})).toEqual({
      state: 'empty',
      layout: 'icon',
      accent: 'neutral',
      line2: '',
      line3: 'No Runs',
    });
  });
});

describe('boardKeySpec — value signals (ready)', () => {
  it('maps issues to a success value with the "Open Issues" label', () => {
    const data: RepoSignalData = { issues: { status: 'ready', openCount: 5 } };
    expect(boardKeySpec('issues', data)).toEqual({
      state: 'ready',
      layout: 'value',
      accent: 'success',
      line2: '5',
      line3: 'Open Issues',
    });
  });

  it('abbreviates large issue counts via formatCount', () => {
    const data: RepoSignalData = { issues: { status: 'ready', openCount: 1500 } };
    expect(boardKeySpec('issues', data).line2).toBe('1.5k');
  });

  it('coalesces a missing issue count to 0', () => {
    const data: RepoSignalData = { issues: { status: 'ready' } };
    expect(boardKeySpec('issues', data).line2).toBe('0');
  });

  it('maps pull requests to a success value with the "Open PRs" label', () => {
    const data: RepoSignalData = { pullRequests: { status: 'ready', openCount: 3 } };
    expect(boardKeySpec('pullRequests', data)).toEqual({
      state: 'ready',
      layout: 'value',
      accent: 'success',
      line2: '3',
      line3: 'Open PRs',
    });
  });

  it('maps reviews to an info value with the "Reviews" label', () => {
    const data: RepoSignalData = { reviews: { status: 'ready', requestedCount: 2 } };
    expect(boardKeySpec('reviews', data)).toEqual({
      state: 'ready',
      layout: 'value',
      accent: 'info',
      line2: '2',
      line3: 'Reviews',
    });
  });

  it('maps stale to a neutral value with the "Stale" label', () => {
    const data: RepoSignalData = { stale: { status: 'ready', staleCount: 7 } };
    expect(boardKeySpec('stale', data)).toEqual({
      state: 'ready',
      layout: 'value',
      accent: 'neutral',
      line2: '7',
      line3: 'Stale',
    });
  });

  it('coalesces a missing pullRequests openCount to 0 (#481)', () => {
    const data: RepoSignalData = { pullRequests: { status: 'ready' } };
    expect(boardKeySpec('pullRequests', data).line2).toBe('0');
  });

  it('coalesces a missing reviews requestedCount to 0 (#481)', () => {
    const data: RepoSignalData = { reviews: { status: 'ready' } };
    expect(boardKeySpec('reviews', data).line2).toBe('0');
  });

  it('coalesces a missing stale staleCount to 0 (#481)', () => {
    const data: RepoSignalData = { stale: { status: 'ready' } };
    expect(boardKeySpec('stale', data).line2).toBe('0');
  });
});

describe('boardKeySpec — security grade → accent', () => {
  const cases: Array<[NonNullable<RepoSignalData['security']>['grade'], AccentTone]> = [
    ['A', 'success'],
    ['B', 'success'],
    ['C', 'warning'],
    ['D', 'failure'],
    ['E', 'failure'],
    ['F', 'failure'],
  ];

  for (const [grade, accent] of cases) {
    it(`maps grade ${grade} to a ${accent} accent with the grade as the value`, () => {
      const data: RepoSignalData = { security: { status: 'ready', grade } };
      expect(boardKeySpec('security', data)).toEqual({
        state: 'ready',
        layout: 'value',
        accent,
        line2: grade,
        line3: 'Security',
      });
    });
  }

  it('renders an explicit "n/a" (not a bare dash) when a ready slice carries no grade', () => {
    const data: RepoSignalData = { security: { status: 'ready' } };
    expect(boardKeySpec('security', data)).toEqual({
      state: 'ready',
      layout: 'value',
      accent: 'neutral',
      line2: 'n/a',
      line3: 'Security',
      srLabel: 'No security-alert access for this repository (token scope or feature disabled)',
    });
  });

  it('rejects invalid grades by returning neutral and not echoing the invalid value into line2 (#484)', () => {
    const data: RepoSignalData = {
      security: { status: 'ready', grade: 'X' as NonNullable<RepoSignalData['security']>['grade'] },
    };
    const spec = boardKeySpec('security', data);
    expect(spec.accent).toBe('neutral');
    expect(spec.line2).not.toBe('X');
  });
});

describe('boardKeySpec — security no-access key explains missing-scope reason', () => {
  it('sets srLabel to the no-access explanation when the security slice is ready with no counts', () => {
    const data: RepoSignalData = { security: { status: 'ready' } };
    const spec = boardKeySpec('security', data);
    expect(spec.srLabel).toBe(
      'No security-alert access for this repository (token scope or feature disabled)',
    );
  });

  it('does NOT set srLabel when ready with a grade (grade is authoritative access signal)', () => {
    const data: RepoSignalData = { security: { status: 'ready', grade: 'A' } };
    // grade is the authoritative access signal: if grade is present the feeds
    // were accessible, regardless of counts — no srLabel for a graded key.
    const spec = boardKeySpec('security', data);
    expect(spec.srLabel).toBeUndefined();
  });

  it('does NOT set srLabel for a fully graded key with counts', () => {
    const data: RepoSignalData = {
      security: {
        status: 'ready',
        grade: 'A',
        counts: { critical: 0, high: 0, medium: 0, low: 0 },
      },
    };
    expect(boardKeySpec('security', data).srLabel).toBeUndefined();
  });

  it('does NOT set srLabel for a security key in the error state', () => {
    const data: RepoSignalData = { security: { status: 'error' } };
    expect(boardKeySpec('security', data).srLabel).toBeUndefined();
  });

  it('does NOT set srLabel for non-security signals in the ready state', () => {
    const data: RepoSignalData = { issues: { status: 'ready', openCount: 5 } };
    expect(boardKeySpec('issues', data).srLabel).toBeUndefined();
  });
});

describe('boardKeySpec — activity (separate input)', () => {
  it('maps a ready activity input to a coral value with the "Commits (7d)" label', () => {
    expect(boardKeySpec('activity', {}, { status: 'ready', commitsThisWeek: 42 })).toEqual({
      state: 'ready',
      layout: 'value',
      accent: 'coral',
      line2: '42',
      line3: 'Commits (7d)',
    });
  });

  it('abbreviates large commit counts via formatCount', () => {
    expect(boardKeySpec('activity', {}, { status: 'ready', commitsThisWeek: 228000 }).line2).toBe(
      '228k',
    );
  });

  it('coalesces a missing commit count to 0', () => {
    expect(boardKeySpec('activity', {}, { status: 'ready' }).line2).toBe('0');
  });

  it('renders a loading activity input as the loading state', () => {
    expect(boardKeySpec('activity', {}, { status: 'loading' })).toEqual({
      state: 'loading',
      layout: 'value',
      accent: 'neutral',
      line2: '…',
      line3: 'Commits (7d)',
    });
  });

  it('renders an errored activity input as the error state with a non-failure accent', () => {
    expect(boardKeySpec('activity', {}, { status: 'error' })).toEqual({
      state: 'error',
      layout: 'value',
      accent: 'warning',
      line2: '—',
      line3: 'Commits (7d)',
    });
  });

  it('renders an unknown activity input as the empty state', () => {
    expect(boardKeySpec('activity', {}, { status: 'unknown' })).toEqual({
      state: 'empty',
      layout: 'value',
      accent: 'neutral',
      line2: '—',
      line3: 'Commits (7d)',
    });
  });

  it('treats an absent activity input as the empty state', () => {
    expect(boardKeySpec('activity', {}).state).toBe('empty');
  });
});

describe('boardKeySpec — lifecycle state machine (value signals)', () => {
  it('loading slice → loading state with a neutral ellipsis placeholder', () => {
    const data: RepoSignalData = { issues: { status: 'loading' } };
    expect(boardKeySpec('issues', data)).toEqual({
      state: 'loading',
      layout: 'value',
      accent: 'neutral',
      line2: '…',
      line3: 'Open Issues',
    });
  });

  it('errored slice → error state with a non-failure (warning) accent', () => {
    const data: RepoSignalData = { pullRequests: { status: 'error' } };
    expect(boardKeySpec('pullRequests', data)).toEqual({
      state: 'error',
      layout: 'value',
      accent: 'warning',
      line2: '—',
      line3: 'Open PRs',
    });
  });

  it('unknown slice → empty state with a neutral em-dash placeholder', () => {
    const data: RepoSignalData = { reviews: { status: 'unknown' } };
    expect(boardKeySpec('reviews', data)).toEqual({
      state: 'empty',
      layout: 'value',
      accent: 'neutral',
      line2: '—',
      line3: 'Reviews',
    });
  });

  it('absent slice → empty state', () => {
    expect(boardKeySpec('stale', {}).state).toBe('empty');
  });

  it('present slice with a missing status field → loading state (defensive)', () => {
    const data = { issues: {} } as unknown as RepoSignalData;
    expect(boardKeySpec('issues', data).state).toBe('loading');
  });

  it('only ever emits accents resolvable through BOARD_KEY_ACCENT_VAR', () => {
    const data: RepoSignalData = {
      ci: { status: 'ready', conclusion: 'failure' },
      issues: { status: 'ready', openCount: 1 },
      security: { status: 'ready', grade: 'C' },
    };
    for (const signal of ['ci', 'issues', 'security'] as const) {
      expect(BOARD_KEY_ACCENT_VAR[boardKeySpec(signal, data).accent]).toBeDefined();
    }
  });
});

describe('boardKeySpec — error accent is distinct from a CI failure (T-bf1)', () => {
  it('never reuses the failure accent for an errored value slice', () => {
    const spec = boardKeySpec('issues', { issues: { status: 'error' } });
    expect(spec.state).toBe('error');
    expect(spec.accent).not.toBe('failure');
    expect(spec.accent).toBe('warning');
  });

  it('never reuses the failure accent for an errored icon (CI) slice', () => {
    const spec = boardKeySpec('ci', { ci: { status: 'error' } });
    expect(spec.state).toBe('error');
    expect(spec.accent).not.toBe('failure');
    expect(spec.accent).toBe('warning');
  });

  it('keeps the failure accent for a genuinely failing CI run (not an error state)', () => {
    const spec = boardKeySpec('ci', { ci: { status: 'ready', conclusion: 'failure' } });
    expect(spec.state).toBe('ready');
    expect(spec.accent).toBe('failure');
  });
});
