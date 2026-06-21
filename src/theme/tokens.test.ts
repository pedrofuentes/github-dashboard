import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config.js';

/**
 * Token-system contract (DESIGN-TILES §1.1–§1.3). These assertions lock the
 * Tailwind ↔ CSS-variable wiring so every downstream recolor PR can rely on the
 * semantic class names resolving to `var(--color-*)`. The raw hex values live in
 * `src/index.css` (`:root` / `.dark`); this test owns the *mapping*, not the hex.
 */
const resolved = resolveConfig(tailwindConfig);
const colors = resolved.theme.colors as unknown as Record<string, string>;

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

  it('preserves the default Tailwind palette alongside the semantic tokens', () => {
    expect(colors.transparent).toBe('transparent');
    expect(colors.current).toBe('currentColor');
  });
});
