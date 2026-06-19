import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CiSignalSlice } from '../../types/fleet';
import { CiCell } from './CiCell';

function readySlice(
  conclusion: CiSignalSlice['conclusion'],
  extra: Partial<CiSignalSlice> = {},
): CiSignalSlice {
  return { status: 'ready', score: 0, conclusion, ...extra };
}

describe('CiCell', () => {
  it('renders a dash plus screen-reader text for an absent slice', () => {
    const { container } = render(<CiCell />);
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')?.textContent ?? '').not.toBe('');
  });

  it('renders the unknown state the same neutral way', () => {
    render(<CiCell slice={{ status: 'unknown' }} />);
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it('renders a loading skeleton with an accessible label', () => {
    render(<CiCell slice={{ status: 'loading' }} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/passing|failing|running/i)).toBeNull();
  });

  it('renders an error indicator with a "couldn\'t load" title and text', () => {
    render(<CiCell slice={{ status: 'error' }} />);
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
    expect(screen.getByTitle(/couldn.t load/i)).toBeInTheDocument();
  });

  it.each<[NonNullable<CiSignalSlice['conclusion']>, string, string, RegExp]>([
    ['success', '✓', 'Passing', /passing/i],
    ['failure', '✗', 'Failing', /failing/i],
    ['in_progress', '⟳', 'Running', /running/i],
    ['queued', '⟳', 'Queued', /queued/i],
    ['none', '–', 'No runs', /no runs/i],
  ])('encodes the %s state with icon, text and aria-label', (conclusion, icon, text, label) => {
    render(<CiCell slice={readySlice(conclusion)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(icon)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('falls back to the no-runs presentation when conclusion is missing', () => {
    render(<CiCell slice={{ status: 'ready', score: 0 }} />);
    expect(screen.getByText('No runs')).toBeInTheDocument();
  });

  it('wraps the cell in a link to a GitHub-owned latest-run URL', () => {
    render(
      <CiCell
        slice={readySlice('failure', {
          score: 100,
          latestRunUrl: 'https://github.com/octo/a/actions/runs/1',
        })}
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://github.com/octo/a/actions/runs/1');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('does not link to a non-GitHub origin', () => {
    render(
      <CiCell
        slice={readySlice('failure', { score: 100, latestRunUrl: 'https://evil.example.com/x' })}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('does not link to a non-https GitHub URL', () => {
    render(
      <CiCell slice={readySlice('failure', { score: 100, latestRunUrl: 'http://github.com/x' })} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not link when the URL is malformed', () => {
    render(<CiCell slice={readySlice('failure', { score: 100, latestRunUrl: 'not-a-url' })} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not render a link when there is no latest-run URL', () => {
    render(<CiCell slice={readySlice('success')} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
