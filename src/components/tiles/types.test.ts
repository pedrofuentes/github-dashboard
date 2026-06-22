import { describe, expect, it } from 'vitest';

import type { TileSignalType } from '../../types/dashboard';
import type { AccentTone, SignalIconKind, TileTier } from './types';
import {
  SIGNAL_IDENTITY_TONE,
  iconKindTone,
  toneBgClass,
  toneTextClass,
  toneTintTextClass,
  toneToVar,
} from './types';

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

  it('falls back to the neutral token for an out-of-allowlist tone (runtime guard)', () => {
    // Defense-in-depth: `tone` is already type-enforced + CSP-guarded, but a
    // type-cast (e.g. unvalidated data coerced to AccentTone) must NOT
    // interpolate an arbitrary string into `var(--color-…)`. Anything outside
    // the canonical allowlist resolves to the neutral token instead.
    expect(toneToVar('haxxor' as AccentTone)).toBe('var(--color-neutral)');
    expect(toneToVar('' as AccentTone)).toBe('var(--color-neutral)');
    expect(toneToVar('success); evil' as AccentTone)).toBe('var(--color-neutral)');
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

describe('toneTintTextClass', () => {
  it('routes coral and warning through their -ink variants for AA over a tint', () => {
    expect(toneTintTextClass('coral')).toBe('text-accent-coral-ink');
    expect(toneTintTextClass('warning')).toBe('text-accent-warning-ink');
  });

  it('keeps the plain accent text token for tones that already clear AA on a tint', () => {
    for (const tone of TONES) {
      if (tone === 'coral' || tone === 'warning') continue;
      expect(toneTintTextClass(tone)).toBe(`text-accent-${tone}`);
    }
  });

  it('never returns a raw hex value', () => {
    for (const tone of TONES) {
      expect(toneTintTextClass(tone)).not.toMatch(/#[0-9a-f]/i);
    }
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
  it('is exactly the three documented density tiers (drift breaks compilation)', () => {
    const ALL_TIERS = ['compact', 'standard', 'expanded'] as const;
    // Bidirectional assignability pins the union to this tuple: adding,
    // removing, or renaming a TileTier member makes one of these `true`
    // assignments stop compiling under `npm run typecheck:test`, instead of
    // silently passing like a hard-coded `toHaveLength(3)` would.
    type Covers = TileTier extends (typeof ALL_TIERS)[number] ? true : false;
    type NoExtra = (typeof ALL_TIERS)[number] extends TileTier ? true : false;
    const covers: Covers = true;
    const noExtra: NoExtra = true;
    expect(covers && noExtra).toBe(true);
    expect(ALL_TIERS).toEqual(['compact', 'standard', 'expanded']);
  });
});

describe('SIGNAL_IDENTITY_TONE', () => {
  it('maps every signal to its calm-header identity accent (DESIGN-TILES §3, §5)', () => {
    const expected: Record<TileSignalType, AccentTone> = {
      ci: 'neutral',
      security: 'neutral',
      pullRequests: 'info',
      reviews: 'info',
      issues: 'neutral',
      stale: 'ochre',
      activity: 'purple',
    };
    const signals = Object.keys(expected) as TileSignalType[];
    for (const signal of signals) {
      expect(SIGNAL_IDENTITY_TONE[signal]).toBe(expected[signal]);
    }
  });

  it('paints Stale ochre and Activity purple as their header identity', () => {
    expect(SIGNAL_IDENTITY_TONE.stale).toBe('ochre');
    expect(SIGNAL_IDENTITY_TONE.activity).toBe('purple');
  });
});
