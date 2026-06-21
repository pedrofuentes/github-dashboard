import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CiSignalSlice, Repo, RepoSignalData } from '../types/fleet';
import { DrillDownDrawer } from './DrillDownDrawer';

const REPO: Repo = { nameWithOwner: 'octo/hello', owner: 'octo', name: 'hello', isPrivate: false };

const FULL_DATA: RepoSignalData = {
  ci: {
    status: 'ready',
    conclusion: 'failure',
    failingCount: 2,
    latestRunUrl: 'https://github.com/octo/hello/actions/runs/9',
  },
  security: { status: 'ready', grade: 'C', counts: { critical: 0, high: 1, medium: 2, low: 3 } },
  reviews: { status: 'ready', requestedCount: 4 },
  pullRequests: { status: 'ready', openCount: 5, externalCount: 1 },
  issues: { status: 'ready', openCount: 7, overThreshold: true },
  stale: { status: 'ready', staleCount: 6 },
};

function eachSlice(status: 'loading' | 'error'): RepoSignalData {
  return {
    ci: { status },
    security: { status },
    reviews: { status },
    pullRequests: { status },
    issues: { status },
    stale: { status },
  };
}

function Harness({ data = {}, repo = REPO }: { data?: RepoSignalData; repo?: Repo }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open drawer
      </button>
      {open ? <DrillDownDrawer repo={repo} data={data} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DrillDownDrawer accessibility', () => {
  it('renders a modal dialog labelled by the repository name', () => {
    render(<DrillDownDrawer repo={REPO} data={{}} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('octo/hello');
  });

  it('moves focus into the drawer (onto the close control) when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /open drawer/i }));

    const closeButton = screen.getByRole('button', { name: /close details/i });
    await waitFor(() => expect(closeButton).toHaveFocus());
    expect(screen.getByRole('dialog')).toContainElement(closeButton);
  });

  it('closes on Escape and returns focus to the triggering control', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /open drawer/i });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('closes when the close control is activated', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /open drawer/i }));
    await user.click(screen.getByRole('button', { name: /close details/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DrillDownDrawer repo={REPO} data={{}} onClose={onClose} />);

    await user.click(screen.getByTestId('drawer-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab focus within the dialog (focus trap)', async () => {
    const user = userEvent.setup();
    render(<DrillDownDrawer repo={REPO} data={FULL_DATA} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});

describe('DrillDownDrawer repository link', () => {
  it('links the repository title to its github.com page', () => {
    render(<DrillDownDrawer repo={REPO} data={{}} onClose={vi.fn()} />);

    const link = screen.getByRole('link', { name: 'octo/hello' });
    expect(link).toHaveAttribute('href', 'https://github.com/octo/hello');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('surfaces a non-visual private indicator for private repos', () => {
    render(<DrillDownDrawer repo={{ ...REPO, isPrivate: true }} data={{}} onClose={vi.fn()} />);

    expect(screen.getByText(/private repository/i)).toBeInTheDocument();
  });
});

describe('DrillDownDrawer signal breakdown', () => {
  it('shows a detailed breakdown of every signal for the selected repo', () => {
    render(<DrillDownDrawer repo={REPO} data={FULL_DATA} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');

    // CI: conclusion + failing count + a github.com link to the latest run
    expect(within(dialog).getByText(/Conclusion: Failing/i)).toBeInTheDocument();
    expect(within(dialog).getByText('2 failing workflows')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /latest run/i })).toHaveAttribute(
      'href',
      'https://github.com/octo/hello/actions/runs/9',
    );

    // Security: grade + per-severity counts
    expect(within(dialog).getByText('Grade: C')).toBeInTheDocument();
    expect(within(dialog).getByText('Critical: 0')).toBeInTheDocument();
    expect(within(dialog).getByText('High: 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Medium: 2')).toBeInTheDocument();
    expect(within(dialog).getByText('Low: 3')).toBeInTheDocument();

    // Reviews / PRs / Issues / Stale
    expect(within(dialog).getByText('4 review requests')).toBeInTheDocument();
    expect(within(dialog).getByText('5 open pull requests')).toBeInTheDocument();
    expect(within(dialog).getByText('1 from new outside contributor')).toBeInTheDocument();
    expect(within(dialog).getByText('7 open issues')).toBeInTheDocument();
    expect(within(dialog).getByText(/over the triage threshold/i)).toBeInTheDocument();
    expect(within(dialog).getByText('6 stale items')).toBeInTheDocument();
  });

  it('uses singular nouns when a count is exactly one', () => {
    const data: RepoSignalData = {
      ci: { status: 'ready', conclusion: 'failure', failingCount: 1 },
      reviews: { status: 'ready', requestedCount: 1 },
      pullRequests: { status: 'ready', openCount: 1, externalCount: 1 },
      issues: { status: 'ready', openCount: 1, overThreshold: false },
      stale: { status: 'ready', staleCount: 1 },
    };
    render(<DrillDownDrawer repo={REPO} data={data} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('1 failing workflow')).toBeInTheDocument();
    expect(within(dialog).getByText('1 review request')).toBeInTheDocument();
    expect(within(dialog).getByText('1 open pull request')).toBeInTheDocument();
    expect(within(dialog).getByText('1 from new outside contributor')).toBeInTheDocument();
    expect(within(dialog).getByText('1 open issue')).toBeInTheDocument();
    expect(within(dialog).getByText('1 stale item')).toBeInTheDocument();
    expect(within(dialog).queryByText(/triage threshold/i)).toBeNull();
  });

  it('omits the external-contributor line and threshold flag when there are none', () => {
    const data: RepoSignalData = {
      pullRequests: { status: 'ready', openCount: 3, externalCount: 0 },
      issues: { status: 'ready', openCount: 0, overThreshold: false },
    };
    render(<DrillDownDrawer repo={REPO} data={data} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('3 open pull requests')).toBeInTheDocument();
    expect(within(dialog).queryByText(/outside contributor/i)).toBeNull();
    expect(within(dialog).queryByText(/triage threshold/i)).toBeNull();
  });

  it('renders the security "no access" state when counts are missing', () => {
    const data: RepoSignalData = { security: { status: 'ready' } };
    render(<DrillDownDrawer repo={REPO} data={data} onClose={vi.fn()} />);

    expect(screen.getByText(/no security-alert access/i)).toBeInTheDocument();
  });
});

describe('DrillDownDrawer security: only github.com links are rendered', () => {
  it('does not render a non-github.com latest-run URL as a link', () => {
    const data: RepoSignalData = {
      ci: {
        status: 'ready',
        conclusion: 'failure',
        failingCount: 1,
        latestRunUrl: 'https://evil.example.com/run',
      },
    };
    render(<DrillDownDrawer repo={REPO} data={data} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByRole('link', { name: /latest run/i })).toBeNull();
    expect(dialog.querySelector('a[href="https://evil.example.com/run"]')).toBeNull();
    // The CI breakdown itself still renders — only the unsafe link is withheld.
    expect(within(dialog).getByText('1 failing workflow')).toBeInTheDocument();
  });
});

describe('DrillDownDrawer slice states', () => {
  it('renders safe placeholders while every slice is loading', () => {
    render(<DrillDownDrawer repo={REPO} data={eachSlice('loading')} onClose={vi.fn()} />);

    expect(screen.getAllByText(/loading/i)).toHaveLength(6);
  });

  it('renders safe placeholders when slices fail to load', () => {
    render(<DrillDownDrawer repo={REPO} data={eachSlice('error')} onClose={vi.fn()} />);

    expect(screen.getAllByText(/couldn.t load/i)).toHaveLength(6);
  });

  it('renders a "no data" placeholder for unresolved (empty) slices', () => {
    render(<DrillDownDrawer repo={REPO} data={{}} onClose={vi.fn()} />);

    expect(screen.getAllByText(/no data yet/i)).toHaveLength(6);
  });
});

describe('DrillDownDrawer unknown CI conclusion (#205)', () => {
  it('falls back to the neutral "No runs" label for an out-of-enum conclusion without crashing', () => {
    // GitHub exposes workflow conclusions beyond our 5-member enum (cancelled,
    // skipped, timed_out, action_required, neutral, stale). An unexpected value
    // must not index the label map to `undefined` (rendering "Conclusion:
    // undefined") — the same unguarded `CONCLUSION[...]` lookup that threw a
    // TypeError in CiTileBody (#185). It must fall back to the neutral "No runs"
    // label, mirroring the CiTileBody guard.
    const slice = { status: 'ready', conclusion: 'cancelled' } as unknown as CiSignalSlice;
    let dialog: HTMLElement | undefined;
    expect(() => {
      render(<DrillDownDrawer repo={REPO} data={{ ci: slice }} onClose={vi.fn()} />);
      dialog = screen.getByRole('dialog');
    }).not.toThrow();

    const scoped = within(dialog as HTMLElement);
    expect(scoped.getByText(/Conclusion: No runs/i)).toBeInTheDocument();
    expect(scoped.queryByText(/undefined/i)).toBeNull();
  });
});
