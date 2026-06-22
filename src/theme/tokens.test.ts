import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config.js';

import { parseColorTokens } from '../lib/css-tokens';

/**
 * Token-system contract (DESIGN-TILES §1.1–§1.3). These assertions lock the
 * Tailwind ↔ CSS-variable wiring so every downstream recolor PR can rely on the
 * semantic class names resolving to `var(--color-*)`. The raw hex values live in
 * `src/index.css` (`:root` / `.dark`); this test owns the *mapping*, not the hex.
 */
const resolved = resolveConfig(tailwindConfig);
// `resolved.theme.colors` is typed as Tailwind's `DefaultColors` (no string
// index signature), so the double-cast through `unknown` is required to index
// it by an arbitrary token name — a direct `as Record<string, string>` is a
// TS2352 error.
const colors = resolved.theme.colors as unknown as Record<string, string>;

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../index.css');
const css = readFileSync(cssPath, 'utf8');
const lightVars = parseColorTokens(css, ':root');
const darkVars = parseColorTokens(css, '.dark');

describe('theme design tokens', () => {
  it('enables class-based dark mode', () => {
    expect(resolved.darkMode).toBe('class');
  });

  const semanticTokens: Record<string, string> = {
    bg: 'var(--color-bg)',
    surface: 'var(--color-surface)',
    'surface-raised': 'var(--color-surface-raised)',
    text: 'var(--color-text)',
    'text-muted': 'var(--color-text-muted)',
    border: 'var(--color-border)',
    'border-strong': 'var(--color-border-strong)',
    focus: 'var(--color-focus)',
    'accent-success': 'var(--color-success)',
    'accent-failure': 'var(--color-failure)',
    'accent-warning': 'var(--color-warning)',
    'accent-info': 'var(--color-info)',
    'accent-neutral': 'var(--color-neutral)',
    'accent-coral': 'var(--color-coral)',
    'accent-purple': 'var(--color-purple)',
    'accent-gold': 'var(--color-gold)',
  };

  it.each(Object.entries(semanticTokens))('maps the "%s" color utility to %s', (token, cssVar) => {
    expect(colors[token]).toBe(cssVar);
  });

  const referencedVars = Object.values(semanticTokens).map((value) =>
    value.replace(/^var\((--color-[\w-]+)\)$/, '$1'),
  );

  it.each(referencedVars)(
    'backs %s with a custom property declared in both :root and .dark',
    (cssVar) => {
      expect(lightVars[cssVar], `${cssVar} missing from :root (light)`).toBeDefined();
      expect(darkVars[cssVar], `${cssVar} missing from .dark (dark)`).toBeDefined();
    },
  );

  it('preserves the default Tailwind palette alongside the semantic tokens', () => {
    expect(colors.transparent).toBe('transparent');
    expect(colors.current).toBe('currentColor');
  });
});
