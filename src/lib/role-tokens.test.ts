import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColorTokens } from './css-tokens';

/**
 * Role design tokens (T-a1) — semantic surfaces/accents for the UI reimagining
 * (settings overlay, multi-select selection states, hover affordances, and a
 * repos×signals matrix). These purely-additive `--color-*` tokens are validated
 * here for:
 *
 * 1. **Light/dark parity** — each new token is defined in BOTH `:root` (light)
 *    and `.dark` (dark); a single-theme token would render an unstyled
 *    `var(--color-…)` fallback in the other theme.
 * 2. **Tailwind mapping** — each new semantic Tailwind name maps to the matching
 *    `var(--color-*)` in `tailwind.config.js`.
 * 3. **AA contrast** — `--color-text` clears 4.5:1 (WCAG 2.1 SC 1.4.3 normal
 *    text) on each hover/selected/overlay surface; `--color-selection` and
 *    `--color-attention` clear 3:1 (WCAG 2.1 SC 1.4.11 non-text UI) vs
 *    `--color-surface` — in BOTH themes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../index.css'), 'utf8');
const tailwindConfig = readFileSync(resolve(here, '../../tailwind.config.js'), 'utf8');

const light = parseColorTokens(css, ':root');
const dark = parseColorTokens(css, '.dark');

const ROLE_TOKENS = [
  '--color-surface-overlay',
  '--color-surface-hover',
  '--color-surface-selected',
  '--color-chart-track',
  '--color-selection',
  '--color-attention',
] as const;

const TAILWIND_MAPPINGS: ReadonlyArray<readonly [string, string]> = [
  ['surface-overlay', '--color-surface-overlay'],
  ['surface-hover', '--color-surface-hover'],
  ['surface-selected', '--color-surface-selected'],
  ['chart-track', '--color-chart-track'],
  ['selection', '--color-selection'],
  ['attention', '--color-attention'],
];

const SURFACE_TEXT_TOKENS = [
  '--color-surface-overlay',
  '--color-surface-hover',
  '--color-surface-selected',
] as const;

describe('role tokens — light/dark parity', () => {
  const themes = [
    { name: 'light', tokens: light },
    { name: 'dark', tokens: dark },
  ] as const;

  for (const token of ROLE_TOKENS) {
    for (const { name, tokens } of themes) {
      it(`defines ${token} in the ${name} theme`, () => {
        expect(tokens[token], `${token} missing from ${name}`).toBeDefined();
      });
    }
  }
});

describe('role tokens — Tailwind semantic mapping', () => {
  for (const [name, variable] of TAILWIND_MAPPINGS) {
    it(`maps "${name}" to var(${variable})`, () => {
      const pattern = new RegExp(`['"]?${name}['"]?\\s*:\\s*['"]var\\(${variable}\\)['"]`);
      expect(pattern.test(tailwindConfig), `missing Tailwind mapping for ${name}`).toBe(true);
    });
  }
});

describe('role tokens — AA contrast (WCAG 2.1)', () => {
  const themes = [
    { name: 'light', tokens: light },
    { name: 'dark', tokens: dark },
  ] as const;

  for (const { name, tokens } of themes) {
    for (const surface of SURFACE_TEXT_TOKENS) {
      it(`text clears 4.5:1 on ${surface} in ${name} theme`, () => {
        expect(tokens['--color-text']).toBeDefined();
        expect(tokens[surface]).toBeDefined();
        const ratio = contrastRatio(tokens['--color-text'], tokens[surface]);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const accent of ['--color-selection', '--color-attention'] as const) {
      it(`${accent} clears 3:1 vs surface in ${name} theme`, () => {
        expect(tokens[accent]).toBeDefined();
        expect(tokens['--color-surface']).toBeDefined();
        const ratio = contrastRatio(tokens[accent], tokens['--color-surface']);
        expect(ratio).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('role tokens — chart-track contrast exemption', () => {
  const themes = [
    { name: 'light', tokens: light },
    { name: 'dark', tokens: dark },
  ] as const;

  for (const { name, tokens } of themes) {
    it(`--color-chart-track is a decorative track element (WCAG contrast exemption) in ${name} theme`, () => {
      expect(tokens['--color-chart-track']).toBeDefined();
      expect(tokens['--color-surface']).toBeDefined();
      const ratio = contrastRatio(tokens['--color-chart-track'], tokens['--color-surface']);
      // Chart tracks are decorative: intentionally below the 3:1 non-text-UI contrast
      // threshold (WCAG 2.1 SC 1.4.11 exemption), but must remain visible against surface.
      // This locks in the design: not invisible (ratio > 1) and not high-contrast (ratio < 3).
      expect(ratio).toBeGreaterThan(1); // Prevents invisible (identical to surface)
      expect(ratio).toBeLessThan(3);    // Prevents accidental high-contrast (e.g., text color)
    });
  }
});

describe('role tokens — semantic distinction', () => {
  it('keeps dark attention visually distinct from warning', () => {
    expect(dark['--color-attention']).not.toBe(dark['--color-warning']);
  });
});
