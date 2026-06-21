import { describe, expect, it } from 'vitest';

import type { AccentTone, SignalIconKind, TileTier } from './types';
import { iconKindTone, toneBgClass, toneTextClass, toneToVar } from './types';

const TONES: AccentTone[] = [
  'success',
  'failure',
  'warning',
  'info',
  'neutral',
  'coral',
  'purple',
  'gold',
  'ochre',
];

const ICON_KINDS: SignalIconKind[] = [
  'success',
  'failure',
  'running',
  'queued',
  'warning',
  'stale',
  'neutral',
  'external',
  'review',
  'loading',
  'unknown',
  'info',
];

describe('toneToVar', () => {
  it('maps every tone to its CSS custom property', () => {
    for (const tone of TONES) {
      expect(toneToVar(tone)).toBe(`var(--color-${tone})`);
    }
  });

  it('never returns a raw hex value', () => {
    for (const tone of TONES) {
      expect(toneToVar(tone)).not.toMatch(/#[0-9a-f]/i);
    }
  });
});

describe('toneTextClass', () => {
  it('maps every tone to its semantic text token class', () => {
    for (const tone of TONES) {
      expect(toneTextClass(tone)).toBe(`text-accent-${tone}`);
    }
  });

  it('maps the ochre tone to its age-led Stale text token', () => {
    expect(toneTextClass('ochre')).toBe('text-accent-ochre');
  });
});

describe('toneBgClass', () => {
  it('maps every tone to its semantic background token class', () => {
    for (const tone of TONES) {
      expect(toneBgClass(tone)).toBe(`bg-accent-${tone}`);
    }
  });

  it('maps the ochre tone to its age-led Stale background token', () => {
    expect(toneBgClass('ochre')).toBe('bg-accent-ochre');
  });
});

describe('iconKindTone', () => {
  it('resolves a tone for every status glyph kind', () => {
    for (const kind of ICON_KINDS) {
      expect(TONES).toContain(iconKindTone(kind));
    }
  });

  it('uses the §2.1 status → accent mapping', () => {
    const expected: Record<SignalIconKind, AccentTone> = {
      success: 'success',
      failure: 'failure',
      running: 'warning',
      queued: 'info',
      warning: 'warning',
      stale: 'warning',
      neutral: 'neutral',
      external: 'coral',
      review: 'warning',
      loading: 'neutral',
      unknown: 'neutral',
      info: 'info',
    };
    for (const kind of ICON_KINDS) {
      expect(iconKindTone(kind)).toBe(expected[kind]);
    }
  });
});

describe('TileTier', () => {
  it('accepts the three documented density tiers', () => {
    const tiers: TileTier[] = ['compact', 'standard', 'expanded'];
    expect(tiers).toHaveLength(3);
  });
});
