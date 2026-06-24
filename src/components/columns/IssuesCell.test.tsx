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

const readyWithSplit = (
  openCount: number,
  communityCount: number,
  mineCount: number,
  overThreshold = false,
): IssuesSignalSlice => ({
  ...ready(openCount, overThreshold),
  communityCount,
  mineCount,
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

describe('IssuesCell — community vs mine split', () => {
  it('renders the community and mine breakdown alongside the unchanged total', () => {
    render(<IssuesCell slice={readyWithSplit(5, 4, 1)} />);

    // The primary total stays as-is…
    expect(screen.getByText(/5 open/)).toBeInTheDocument();
    // …with a compact community/mine annotation beside it.
    expect(screen.getByText(/4 community/)).toBeInTheDocument();
    expect(screen.getByText(/1 mine/)).toBeInTheDocument();
  });

  it('spells out the full split in the accessible label', () => {
    render(<IssuesCell slice={readyWithSplit(5, 4, 1)} />);

    expect(
      screen.getByLabelText('5 open issues — 4 from the community, 1 yours'),
    ).toBeInTheDocument();
  });

  it('keeps the over-threshold clause after the split in the accessible label', () => {
    render(<IssuesCell slice={readyWithSplit(37, 30, 7, true)} />);

    expect(
      screen.getByLabelText(
        '37 open issues — 30 from the community, 7 yours, over the triage threshold',
      ),
    ).toBeInTheDocument();
    // The triage indicator still renders alongside the split.
    const indicator = screen.getByTitle('over the triage threshold');
    expect(indicator.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/30 community/)).toBeInTheDocument();
    expect(screen.getByText(/7 mine/)).toBeInTheDocument();
  });

  it('renders the split when the viewer authored none (all community)', () => {
    render(<IssuesCell slice={readyWithSplit(3, 3, 0)} />);

    expect(
      screen.getByLabelText('3 open issues — 3 from the community, 0 yours'),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 community/)).toBeInTheDocument();
    expect(screen.getByText(/0 mine/)).toBeInTheDocument();
  });

  it('omits the split entirely when the counts are absent (unchanged)', () => {
    render(<IssuesCell slice={ready(5, false)} />);

    expect(screen.getByLabelText('5 open issues')).toBeInTheDocument();
    expect(screen.queryByText(/community/i)).toBeNull();
    expect(screen.queryByText(/\bmine\b/i)).toBeNull();
  });
});
