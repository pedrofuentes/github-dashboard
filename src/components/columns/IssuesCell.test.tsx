import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IssuesSignalSlice } from '../../types/fleet';
import { IssuesCell } from './IssuesCell';

const ready = (openCount: number, overThreshold: boolean): IssuesSignalSlice => ({
  status: 'ready',
  openCount,
  overThreshold,
  score: overThreshold ? openCount : Math.floor(openCount / 4),
});

describe('IssuesCell', () => {
  it('shows the open count with an accessible label when under the threshold', () => {
    render(<IssuesCell slice={ready(5, false)} />);

    expect(screen.getByLabelText('5 open issues')).toBeInTheDocument();
    expect(screen.getByText(/5 open/)).toBeInTheDocument();
  });

  it('uses the singular noun for a single open issue', () => {
    render(<IssuesCell slice={ready(1, false)} />);

    expect(screen.getByLabelText('1 open issue')).toBeInTheDocument();
  });

  it('omits the triage indicator when the repo is under the threshold', () => {
    render(<IssuesCell slice={ready(5, false)} />);

    expect(screen.queryByTitle('over the triage threshold')).toBeNull();
  });

  it('marks an over-threshold repo non-visually and with a titled indicator', () => {
    render(<IssuesCell slice={ready(37, true)} />);

    // Non-colour conveyance: the accessible label spells out the triage state.
    expect(screen.getByLabelText('37 open issues, over the triage threshold')).toBeInTheDocument();

    const indicator = screen.getByTitle('over the triage threshold');
    expect(indicator).toBeInTheDocument();
    // Shape (icon), not colour alone, carries the warning for colour-blind users.
    expect(indicator.querySelector('svg')).not.toBeNull();
  });

  it('renders an accessible skeleton while loading', () => {
    const { container } = render(<IssuesCell slice={{ status: 'loading' }} />);

    expect(screen.getByText(/loading issue count/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders an accessible dash on error', () => {
    render(<IssuesCell slice={{ status: 'error' }} />);

    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/issue count unavailable/i)).toBeInTheDocument();
  });

  it('renders a neutral placeholder when no slice is available', () => {
    const { container } = render(<IssuesCell />);

    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')?.textContent ?? '').not.toBe('');
  });

  it('renders a neutral placeholder for the unknown status', () => {
    render(<IssuesCell slice={{ status: 'unknown' }} />);

    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });
});
