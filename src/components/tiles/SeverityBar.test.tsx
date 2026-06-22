import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SeverityBar } from './SeverityBar';

describe('SeverityBar', () => {
  it('renders one filled segment per non-zero severity', () => {
    const { container } = render(
      <SeverityBar
        segments={[
          { tone: 'failure', value: 2, label: 'Critical' },
          { tone: 'warning', value: 3, label: 'High' },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-tone]')).toHaveLength(2);
  });

  it('omits zero-value segments entirely', () => {
    const { container } = render(
      <SeverityBar
        segments={[
          { tone: 'failure', value: 0, label: 'Critical' },
          { tone: 'warning', value: 4, label: 'High' },
        ]}
      />,
    );
    const segs = container.querySelectorAll('[data-tone]');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveAttribute('data-tone', 'warning');
  });

  it('sizes each segment proportionally to its value', () => {
    const { container } = render(
      <SeverityBar
        segments={[
          { tone: 'failure', value: 1, label: 'Critical' },
          { tone: 'warning', value: 3, label: 'High' },
        ]}
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('[data-tone]');
    expect(segs[0].style.width).toBe('25%');
    expect(segs[1].style.width).toBe('75%');
  });

  it('uses an explicit max to leave the bar partially empty', () => {
    const { container } = render(
      <SeverityBar segments={[{ tone: 'failure', value: 2, label: 'Critical' }]} max={10} />,
    );
    const seg = container.querySelector<HTMLElement>('[data-tone]');
    expect(seg?.style.width).toBe('20%');
  });

  it('colourises segments with the tone background token', () => {
    const { container } = render(
      <SeverityBar segments={[{ tone: 'failure', value: 1, label: 'Critical' }]} />,
    );
    const seg = container.querySelector('[data-tone]') as HTMLElement;
    expect(seg.className).toContain('bg-accent-failure');
  });

  it('exposes a screen-reader region labelling each segment value', () => {
    render(
      <SeverityBar
        segments={[
          { tone: 'failure', value: 2, label: 'Critical' },
          { tone: 'warning', value: 5, label: 'High' },
        ]}
      />,
    );
    expect(screen.getByText(/Critical/)).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it('renders nothing visible but stays safe when all segments are zero', () => {
    const { container } = render(
      <SeverityBar segments={[{ tone: 'failure', value: 0, label: 'Critical' }]} />,
    );
    expect(container.querySelectorAll('[data-tone]')).toHaveLength(0);
  });
});

describe('SeverityBar — grayscale-safe channels', () => {
  it('renders a 1px inter-segment divider by default so adjacent fills survive grayscale', () => {
    const { container } = render(
      <SeverityBar
        segments={[
          { tone: 'failure', value: 2, label: 'Critical' },
          { tone: 'coral', value: 3, label: 'High' },
          { tone: 'info', value: 1, label: 'Medium' },
        ]}
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('[data-tone]');
    // The first segment has no leading divider…
    expect(segs[0].className).not.toContain('border-l');
    // …every later segment carries the 1px surface divider (WCAG 1.4.1) — the
    // baseline grayscale channel, not the opt-in 2px reinforcement.
    expect(segs[1].className).toContain('border-l');
    expect(segs[1].className).toContain('border-surface');
    expect(segs[1].className).not.toContain('border-l-2');
    expect(segs[2].className).toContain('border-l');
    expect(segs[2].className).toContain('border-surface');
    expect(segs[2].className).not.toContain('border-l-2');
  });

  it('adds a 2px divider before every segment after the first when dividers are on', () => {
    const { container } = render(
      <SeverityBar
        dividers
        segments={[
          { tone: 'failure', value: 2, label: 'Critical' },
          { tone: 'coral', value: 3, label: 'High' },
          { tone: 'info', value: 1, label: 'Medium' },
        ]}
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('[data-tone]');
    expect(segs[0].className).not.toContain('border-l-2');
    expect(segs[1].className).toContain('border-l-2');
    expect(segs[2].className).toContain('border-l-2');
  });

  it('steps visible segment heights down by render order so order survives grayscale', () => {
    const { container } = render(
      <SeverityBar
        stepped
        segments={[
          { tone: 'failure', value: 2, label: 'Critical' },
          { tone: 'coral', value: 3, label: 'High' },
          { tone: 'info', value: 1, label: 'Medium' },
        ]}
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('[data-tone]');
    expect(segs[0].style.height).toBe('100%');
    expect(segs[1].style.height).toBe('80%');
    expect(segs[2].style.height).toBe('60%');
  });

  it('keeps width proportional to value while stepping height', () => {
    const { container } = render(
      <SeverityBar
        stepped
        segments={[
          { tone: 'failure', value: 1, label: 'Critical' },
          { tone: 'coral', value: 3, label: 'High' },
        ]}
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('[data-tone]');
    expect(segs[0].style.width).toBe('25%');
    expect(segs[1].style.width).toBe('75%');
  });
});
