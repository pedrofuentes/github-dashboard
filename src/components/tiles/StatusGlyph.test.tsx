import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SignalIconKind } from './types';
import { StatusGlyph } from './StatusGlyph';

describe('StatusGlyph', () => {
  it('renders an accessible SVG with a default label for the status', () => {
    render(<StatusGlyph status="success" />);
    const img = screen.getByRole('img', { name: /passing/i });
    expect(img.tagName.toLowerCase()).toBe('svg');
  });

  it('honours an explicit title over the default label', () => {
    render(<StatusGlyph status="failure" title="Build broke" />);
    expect(screen.getByRole('img', { name: 'Build broke' })).toBeInTheDocument();
  });

  it('colourises via the tone token class (never colour alone — has a label too)', () => {
    const { container } = render(<StatusGlyph status="failure" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('text-accent-failure');
    // Redundant encoding: an accessible name exists in addition to colour.
    expect(screen.getByRole('img').getAttribute('aria-label')).toBeTruthy();
  });

  it('applies the requested pixel size to the SVG', () => {
    render(<StatusGlyph status="neutral" size={32} />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('defaults to a 16px glyph', () => {
    render(<StatusGlyph status="queued" />);
    expect(screen.getByRole('img')).toHaveAttribute('width', '16');
  });

  it('renders the loading variant as a spinner that stops under reduced motion', () => {
    const { container } = render(<StatusGlyph status="loading" />);
    const spinner = container.querySelector('[data-status="loading"]') as HTMLElement;
    expect(spinner).toBeTruthy();
    // Spins normally, but the motion-reduce variant disables the animation.
    expect(spinner.getAttribute('class') ?? '').toContain('animate-spin');
    expect(spinner.getAttribute('class') ?? '').toContain('motion-reduce:animate-none');
  });

  it('renders every documented status kind with a usable accessible name', () => {
    const kinds: SignalIconKind[] = [
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
    for (const status of kinds) {
      const { unmount } = render(<StatusGlyph status={status} />);
      const name = screen.getByRole('img').getAttribute('aria-label') ?? '';
      expect(name.length).toBeGreaterThan(0);
      unmount();
    }
  });

  const STATUS_LABELS: ReadonlyArray<[SignalIconKind, string]> = [
    ['success', 'Passing'],
    ['failure', 'Failing'],
    ['running', 'Running'],
    ['queued', 'Queued'],
    ['warning', 'Warning'],
    ['stale', 'Stale'],
    ['neutral', 'None'],
    ['external', 'External'],
    ['review', 'Awaiting you'],
    ['loading', 'Loading…'],
    ['unknown', 'Unavailable'],
    ['info', 'Info'],
  ];

  it.each(STATUS_LABELS)('gives the %s glyph its default accessible name "%s"', (status, label) => {
    // Per-status characterization: a wrong/dropped label for ANY status (not
    // just `success`) must fail here — colour-blind users rely on this text.
    render(<StatusGlyph status={status} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(label);
  });

  it('exposes the status via a data attribute', () => {
    const { container } = render(<StatusGlyph status="external" />);
    expect(container.querySelector('[data-status="external"]')).toBeTruthy();
  });
});
