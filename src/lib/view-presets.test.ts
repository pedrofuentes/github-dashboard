import { describe, expect, it } from 'vitest';

import { isQueryActive } from './repo-filter-query';
import { SavedViewSchema } from './saved-views';
import { buildViewPresets, isPresetId } from './view-presets';

describe('buildViewPresets', () => {
  it('returns the expected stable preset ids', () => {
    const ids = buildViewPresets().map((preset) => preset.id);
    expect(ids).toEqual([
      'preset:needs-attention',
      'preset:awaiting-review',
      'preset:failing-ci',
      'preset:security-risk',
      'preset:stale',
      'preset:all-repos',
    ]);
  });

  it('returns only schema-valid SavedViews', () => {
    for (const preset of buildViewPresets()) {
      expect(() => SavedViewSchema.parse(preset)).not.toThrow();
    }
  });

  it('builds fresh, independent presets on each call (no shared mutable state)', () => {
    const first = buildViewPresets();
    const second = buildViewPresets();
    expect(first).not.toBe(second);
    first[0].filter.facets.health.push('warning');
    expect(second[0].filter.facets.health).toEqual(['broken']);
  });

  it('targets the correct fleet view for each preset', () => {
    const byId = new Map(buildViewPresets().map((preset) => [preset.id, preset]));
    expect(byId.get('preset:needs-attention')?.view).toBe('triage');
    expect(byId.get('preset:awaiting-review')?.view).toBe('triage');
    expect(byId.get('preset:failing-ci')?.view).toBe('matrix');
    expect(byId.get('preset:security-risk')?.view).toBe('matrix');
    expect(byId.get('preset:stale')?.view).toBe('grid');
    expect(byId.get('preset:all-repos')?.view).toBe('matrix');
  });

  it('sets the right active facet for each preset', () => {
    const byId = new Map(buildViewPresets().map((preset) => [preset.id, preset]));
    expect(byId.get('preset:needs-attention')?.filter.facets.health).toContain('broken');
    expect(byId.get('preset:awaiting-review')?.filter.facets.reviews).toContain('awaiting-me');
    expect(byId.get('preset:failing-ci')?.filter.facets.ci).toContain('failure');
    expect(byId.get('preset:security-risk')?.filter.facets.security.maxGrade).toBe('C');
    expect(byId.get('preset:stale')?.filter.facets.stale).toContain('any');
  });

  it('marks every preset except all-repos as an active query', () => {
    for (const preset of buildViewPresets()) {
      if (preset.id === 'preset:all-repos') {
        expect(isQueryActive(preset.filter)).toBe(false);
      } else {
        expect(isQueryActive(preset.filter)).toBe(true);
      }
    }
  });

  it('uses a constant createdAt and preset-prefixed ids', () => {
    for (const preset of buildViewPresets()) {
      expect(preset.id.startsWith('preset:')).toBe(true);
      expect(preset.createdAt).toBe('1970-01-01T00:00:00.000Z');
    }
  });
});

describe('isPresetId', () => {
  it('recognises preset ids', () => {
    expect(isPresetId('preset:failing-ci')).toBe(true);
    expect(isPresetId('preset:anything')).toBe(true);
  });

  it('rejects non-preset ids', () => {
    expect(isPresetId('user-view-1')).toBe(false);
    expect(isPresetId('')).toBe(false);
  });
});
