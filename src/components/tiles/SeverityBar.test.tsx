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
