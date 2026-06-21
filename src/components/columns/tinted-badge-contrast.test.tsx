import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PullRequestsCell } from './PullRequestsCell';
import { ReviewsCell } from './ReviewsCell';
import { SecurityCell } from './SecurityCell';
import { StaleCell } from './StaleCell';

/**
 * Guards the AA-contrast regression Sentinel rejected on PR #171: the warning
 * and coral *tinted* badges rendered their `text-xs` (12px) label in the
 * accent-700 token, which is only 4.38–4.48:1 over its own 10% tint in the
 * light theme — below the 4.5:1 SC 1.4.3 floor for normal text. The fix routes
 * those labels through dedicated `--color-*-ink` tokens (amber-800 / orange-800
 * in light, unchanged accent in dark). These tests assert both the rendered
 * markup uses the ink tokens and that the resolved hex pairings clear 4.5:1 in
 * BOTH themes, so the regression cannot recur.
 */

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.css');
const css = readFileSync(cssPath, 'utf8');

function tokens(selector: string): Record<string, string> {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`token block ${selector} not found`);
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** sRGB `color-mix(in srgb, a p%, b)` — gamma-space channel interpolation. */
function mix(a: string, b: string, percentA: number): [number, number, number] {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const f = percentA / 100;
  return [0, 1, 2].map((i) => Math.round(A[i] * f + B[i] * (1 - f))) as [number, number, number];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '\\.dark' },
] as const;

describe('tinted-badge contrast (PR #171 AA regression guard)', () => {
  for (const { name, selector } of themes) {
    const t = tokens(selector);

    it(`warning tinted badge ink clears 4.5:1 for 12px text in ${name} theme`, () => {
      const tint = mix(t['--color-warning'], t['--color-surface'], 10);
      const ratio = contrast(hexToRgb(t['--color-warning-ink']), tint);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`coral tinted badge ink clears 4.5:1 for 12px text in ${name} theme`, () => {
      const tint = mix(t['--color-coral'], t['--color-surface'], 10);
      const ratio = contrast(hexToRgb(t['--color-coral-ink']), tint);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('ReviewsCell badge text uses the warning-ink token, not the raw accent', () => {
    render(<ReviewsCell slice={{ status: 'ready', requestedCount: 2, score: 20 }} />);
    const badge = screen.getByRole('img', { name: /awaiting your review/i });
    expect(badge.className).toContain('text-accent-warning-ink');
    expect(badge.className).not.toMatch(/text-accent-warning(?![\w-])/);
  });

  it('StaleCell badge text uses the warning-ink token, not the raw accent', () => {
    render(<StaleCell slice={{ status: 'ready', staleCount: 3, score: 30 }} />);
    const badge = screen.getByRole('img', { name: /no activity/i });
    expect(badge.className).toContain('text-accent-warning-ink');
    expect(badge.className).not.toMatch(/text-accent-warning(?![\w-])/);
  });

  it('SecurityCell grade-C badge text uses the warning-ink token, not the raw accent', () => {
    const { container } = render(
      <SecurityCell
        slice={{
          status: 'ready',
          grade: 'C',
          counts: { critical: 0, high: 0, medium: 2, low: 1 },
        }}
      />,
    );
    const badge = container.querySelector('.ring-1');
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain('text-accent-warning-ink');
    expect(badge?.className).not.toMatch(/text-accent-warning(?![\w-])/);
  });

  it('PullRequestsCell external badge text uses the coral-ink token, not the raw accent', () => {
    render(
      <PullRequestsCell slice={{ status: 'ready', openCount: 4, externalCount: 2 }} />,
    );
    const badge = screen.getByTitle(/from new outside contributors/i);
    expect(badge.className).toContain('text-accent-coral-ink');
    expect(badge.className).not.toMatch(/text-accent-coral(?![\w-])/);
  });
});
