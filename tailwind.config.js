/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Semantic, CSS-variable-backed color tokens (DESIGN-TILES §1.1–§1.3).
      // Components reference these names only (e.g. `bg-surface text-text`);
      // the raw hex lives once per theme in src/index.css (`:root` / `.dark`),
      // so a single `.dark` class on <html> flips the whole tree.
      colors: {
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
        'accent-warning-ink': 'var(--color-warning-ink)',
        'accent-info': 'var(--color-info)',
        'accent-neutral': 'var(--color-neutral)',
        'accent-coral': 'var(--color-coral)',
        'accent-coral-ink': 'var(--color-coral-ink)',
        'accent-purple': 'var(--color-purple)',
        'accent-gold': 'var(--color-gold)',
      },
    },
  },
  plugins: [],
};
