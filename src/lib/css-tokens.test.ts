import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, mixSrgb, parseColorTokens } from './css-tokens';

/**
 * T19 — Light-theme contrast verification.
 *
 * Parses `src/index.css` and guards two invariants the tile redesign relies on:
 *
 * 1. **Per-theme token parity** — every `--color-*` custom property defined in
 *    the light `:root` block is ALSO defined in the dark `.dark` block and
 *    vice-versa. A token added to only one theme (e.g. a future
 *    `--color-ochre` shipped to `:root` but forgotten in `.dark`) makes the
 *    app render an unstyled `var(--color-…)` fallback in the other theme — this
 *    test FAILS on any such single-theme token.
 * 2. **AA contrast for the new redesign pairings** — the new `--color-ochre`
 *    (age-led Stale ink) and `--color-coral-ink` (high-severity text) clear the
 *    WCAG 2.1 SC 1.4.3 4.5:1 floor for normal text on their tile surface in
 *    BOTH themes.
 */

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../index.css');
const css = readFileSync(cssPath, 'utf8');

const light = parseColorTokens(css, ':root');
const dark = parseColorTokens(css, '.dark');

describe('per-theme --color-* token parity', () => {
  it('parses a non-empty token set for each theme', () => {
    expect(Object.keys(light).length).toBeGreaterThan(0);
    expect(Object.keys(dark).length).toBeGreaterThan(0);
  });

  it('defines exactly the same token names in :root (light) and .dark (dark)', () => {
    const lightNames = Object.keys(light).sort();
    const darkNames = Object.keys(dark).sort();
    expect(lightNames).toEqual(darkNames);
  });

  it('has no token defined in only one theme (single-theme guard)', () => {
    const onlyLight = Object.keys(light).filter((name) => !(name in dark));
    const onlyDark = Object.keys(dark).filter((name) => !(name in light));
    expect(onlyLight).toEqual([]);
    expect(onlyDark).toEqual([]);
  });

  it('defines the new redesign tokens in both themes', () => {
    for (const token of ['--color-ochre', '--color-coral-ink', '--color-warning-ink']) {
      expect(light[token], `${token} missing from :root`).toBeDefined();
      expect(dark[token], `${token} missing from .dark`).toBeDefined();
    }
  });
});

describe('new-token AA contrast (WCAG 2.1 SC 1.4.3, 4.5:1 normal text)', () => {
  const themes = [
    { name: 'light', tokens: light },
    { name: 'dark', tokens: dark },
  ] as const;

  for (const { name, tokens } of themes) {
    it(`ochre ink clears 4.5:1 on the tile surface in ${name} theme`, () => {
      const ratio = contrastRatio(tokens['--color-ochre'], tokens['--color-surface']);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`ochre ink clears 4.5:1 on a 10% ochre tint in ${name} theme`, () => {
      const tint = mixSrgb(tokens['--color-ochre'], tokens['--color-surface'], 10);
      const ratio = contrastRatio(tokens['--color-ochre'], tint);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`coral (high-severity) ink clears 4.5:1 on the tile surface in ${name} theme`, () => {
      const ratio = contrastRatio(tokens['--color-coral-ink'], tokens['--color-surface']);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});
