import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SecuritySignalSlice } from '../../types/fleet';
import { SecurityCell } from './SecurityCell';

function ready(partial: Partial<SecuritySignalSlice>): SecuritySignalSlice {
  return { status: 'ready', ...partial };
}

describe('SecurityCell', () => {
  it('shows the grade badge, a compact severity summary, and an accessible label', () => {
    render(
      <SecurityCell
        slice={ready({
          score: 221,
          grade: 'F',
          counts: { critical: 2, high: 1, medium: 0, low: 0 },
        })}
      />,
    );

    expect(screen.getByText('F')).toBeInTheDocument();
    expect(screen.getByText('C2 H1')).toBeInTheDocument();
    // Letter + words convey state — never colour alone (WCAG AA).
    expect(screen.getByText('Security grade F: 2 critical, 1 high')).toBeInTheDocument();
  });

  it('summarises medium and low severities too', () => {
    render(
      <SecurityCell
        slice={ready({
          score: 25,
          grade: 'D',
          counts: { critical: 0, high: 0, medium: 3, low: 5 },
        })}
      />,
    );

    expect(screen.getByText('M3 L5')).toBeInTheDocument();
    expect(screen.getByText('Security grade D: 3 medium, 5 low')).toBeInTheDocument();
  });

  it('renders an all-clear state with a check and the word "Clear" (not colour alone)', () => {
    render(
      <SecurityCell
        slice={ready({ score: 0, grade: 'A', counts: { critical: 0, high: 0, medium: 0, low: 0 } })}
      />,
    );

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.getByText('Security grade A: no open alerts')).toBeInTheDocument();
  });

  it('renders a muted "n/a" with a title when no alert feed is accessible', () => {
    render(<SecurityCell slice={ready({})} />);

    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(
      screen.getByText(/security alerts not available for this repository/i),
    ).toBeInTheDocument();
    expect(screen.getByText('n/a').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringMatching(/token scope or feature disabled/i),
    );
  });

  it('renders a decorative skeleton while loading', () => {
    const { container } = render(<SecurityCell slice={{ status: 'loading' }} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.getByText(/loading security alerts/i)).toBeInTheDocument();
  });

  it('renders an accessible em dash on error', () => {
    render(<SecurityCell slice={{ status: 'error' }} />);

    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/security alerts failed to load/i)).toBeInTheDocument();
  });

  it('renders a neutral placeholder for an absent slice', () => {
    const { container } = render(<SecurityCell slice={undefined} />);

    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')?.textContent ?? '').not.toBe('');
  });

  it('treats an unknown status like an absent slice', () => {
    render(<SecurityCell slice={{ status: 'unknown' }} />);
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the compact severity summary out of the accessibility tree', () => {
    render(
      <SecurityCell
        slice={ready({
          score: 100,
          grade: 'F',
          counts: { critical: 1, high: 0, medium: 0, low: 0 },
        })}
      />,
    );

    expect(screen.getByText('C1')).toHaveAttribute('aria-hidden', 'true');
  });

  it('flags a truncated (partial) count with text + icon + an accessible note (#77)', () => {
    render(
      <SecurityCell
        slice={ready({
          score: 221,
          grade: 'F',
          counts: { critical: 2, high: 1, medium: 0, low: 0 },
          truncated: true,
        })}
      />,
    );

    // The accessible label must say the count is partial / a lower bound — not
    // colour alone — so a screen-reader user learns the grade is understated.
    expect(
      screen.getByLabelText(/at least 2 critical, 1 high.*partial/i),
    ).toBeInTheDocument();
    // A visible, decorative "partial" marker accompanies it (text, not colour).
    const marker = screen.getByText('partial');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no partial marker when the count is complete (#77)', () => {
    render(
      <SecurityCell
        slice={ready({
          score: 221,
          grade: 'F',
          counts: { critical: 2, high: 1, medium: 0, low: 0 },
          truncated: false,
        })}
      />,
    );

    expect(screen.queryByText(/partial/i)).toBeNull();
    expect(screen.getByText('Security grade F: 2 critical, 1 high')).toBeInTheDocument();
  });
});
