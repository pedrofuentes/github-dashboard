/**
 * CSS design-token helpers used by contrast/parity tests.
 *
 * The dashboard defines every colour once per theme as a `--color-*` custom
 * property in `src/index.css` (`:root` for light, `.dark` for dark). These pure
 * functions parse those blocks and compute WCAG 2.1 relative-luminance contrast
 * ratios so tests can assert per-theme parity and AA compliance without a
 * browser.
 */

export type ColorTokens = Record<string, string>;

type Rgb = [number, number, number];

/**
 * Extracts the `--color-*` custom properties (with 6-digit hex values) from the
 * CSS rule block matching `selector` (e.g. `:root` or `.dark`).
 *
 * @throws if the selector's block cannot be found in the supplied CSS.
 */
export function parseColorTokens(css: string, selector: string): ColorTokens {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) {
    throw new Error(`token block "${selector}" not found`);
  }
  const out: ColorTokens = {};
  for (const match of block[1].matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[match[1]] = match[2].toLowerCase();
  }
  return out;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Gamma-space (sRGB) channel interpolation, matching CSS
 * `color-mix(in srgb, a percentA%, b)`.
 */
export function mixSrgb(a: string, b: string, percentA: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const f = percentA / 100;
  const channels = [0, 1, 2].map((i) => Math.round(A[i] * f + B[i] * (1 - f)));
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two hex colours, in the range [1, 21].
 * Order-independent.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
