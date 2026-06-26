import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { TriageView } from './TriageView';

const repo = (nameWithOwner: string, isPrivate = false): Repo => {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
};

const FAILING_CI: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
const REVIEW_REQUESTED: RepoSignalData = { reviews: { status: 'ready', requestedCount: 2 } };
const EXTERNAL_PR: RepoSignalData = {
  pullRequests: { status: 'ready', openCount: 3, externalCount: 1 },
};
const STALE: RepoSignalData = { stale: { status: 'ready', staleCount: 4 } };
const ISSUES_OVER_THRESHOLD: RepoSignalData = {
  issues: { status: 'ready', openCount: 727, overThreshold: true },
};
const HEALTHY: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
  security: { status: 'ready', grade: 'A' },
};

function rowDataFor(map: Record<string, RepoSignalData>): GetRowData {
  return (r) => map[r.nameWithOwner] ?? {};
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TriageView structure', () => {
  it('renders a section labelled for triage', () => {
    render(<TriageView repos={[repo('octo/a')]} getRowData={() => FAILING_CI} />);
    expect(screen.getByRole('region', { name: /triage/i })).toBeInTheDocument();
  });

  it('renders a heading with a count for each non-empty band', () => {
    const repos = [repo('octo/broken'), repo('octo/review'), repo('octo/external')];
    render(
      <TriageView
        repos={repos}
        getRowData={rowDataFor({
          'octo/broken': FAILING_CI,
          'octo/review': REVIEW_REQUESTED,
          'octo/external': EXTERNAL_PR,
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: /needs attention.*1/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /waiting on me.*1/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /community.*1/i })).toBeInTheDocument();
  });

  it('omits bands that have no repos', () => {
    render(<TriageView repos={[repo('octo/broken')]} getRowData={() => FAILING_CI} />);
    expect(screen.queryByRole('heading', { name: /waiting on me/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /community/i })).not.toBeInTheDocument();
  });

  it('orders the bands worst-first in the DOM', () => {
    const repos = [repo('octo/watch'), repo('octo/broken'), repo('octo/external')];
    render(
      <TriageView
        repos={repos}
        getRowData={rowDataFor({
          'octo/watch': STALE,
          'octo/broken': FAILING_CI,
          'octo/external': EXTERNAL_PR,
        })}
      />,
    );
    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent ?? '')
      .filter((t) => /needs attention|community|watch|waiting on me/i.test(t));
    expect(headings[0]).toMatch(/needs attention/i);
    expect(headings[1]).toMatch(/community/i);
    expect(headings[2]).toMatch(/watch/i);
  });

  it('lists a repo in only its highest band (dedup)', () => {
    // Failing CI AND review-requested → appears under Needs attention only
    render(
      <TriageView
        repos={[repo('octo/dup')]}
        getRowData={() => ({ ...FAILING_CI, ...REVIEW_REQUESTED })}
      />,
    );
    expect(screen.getAllByText('octo/dup')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /waiting on me/i })).not.toBeInTheDocument();
  });

  it('shows the relevant signal indicator for the band', () => {
    render(<TriageView repos={[repo('octo/review')]} getRowData={() => REVIEW_REQUESTED} />);
    expect(screen.getByRole('img', { name: /awaiting your review/i })).toBeInTheDocument();
  });

  it('surfaces ALL active signals for a repo, not just its band’s (regression)', () => {
    // A repo banded "Needs attention" via issues-over-threshold (e.g. 727 issues)
    // that ALSO has pending review requests must surface BOTH indicators — the
    // band-only renderer hid the review badge.
    render(
      <TriageView
        repos={[repo('octo/busy')]}
        getRowData={() => ({ ...ISSUES_OVER_THRESHOLD, ...REVIEW_REQUESTED })}
      />,
    );

    const region = screen.getByRole('region', { name: /needs attention/i });
    // The issues (over-threshold) indicator — why it's in this band…
    expect(within(region).getByLabelText(/over the triage threshold/i)).toBeInTheDocument();
    // …and the pending-review indicator, which the band-only renderer hid.
    expect(within(region).getByRole('img', { name: /awaiting your review/i })).toBeInTheDocument();
  });
});

describe('TriageView drill-down', () => {
  it('activates a repo via an accessible button with the right repo', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    render(
      <TriageView
        repos={[repo('octo/hello')]}
        getRowData={() => FAILING_CI}
        onRepoActivate={onRepoActivate}
      />,
    );

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello/i }));
    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/hello' }),
    );
  });

  it('does not render an activation button when onRepoActivate is absent', () => {
    render(<TriageView repos={[repo('octo/hello')]} getRowData={() => FAILING_CI} />);
    expect(
      screen.queryByRole('button', { name: /view details for octo\/hello/i }),
    ).not.toBeInTheDocument();
  });
});

describe('TriageView healthy band', () => {
  const repos = [repo('octo/broken'), repo('octo/healthy1'), repo('octo/healthy2')];
  const getRowData = rowDataFor({
    'octo/broken': FAILING_CI,
    'octo/healthy1': HEALTHY,
    'octo/healthy2': HEALTHY,
  });

  it('collapses the Healthy band by default (rows hidden, aria-expanded false)', () => {
    render(<TriageView repos={repos} getRowData={getRowData} />);
    const toggle = screen.getByRole('button', { name: /healthy.*2/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const healthyRow = screen.queryByText('octo/healthy1');
    if (healthyRow) {
      expect(healthyRow).not.toBeVisible();
    }
  });

  it('keeps the collapsed Healthy controlled region in the DOM', () => {
    render(<TriageView repos={repos} getRowData={getRowData} />);
    const toggle = screen.getByRole('button', { name: /healthy.*2/i });
    const controlledRegionId = toggle.getAttribute('aria-controls');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(controlledRegionId).toBeTruthy();
    const controlledRegion = document.getElementById(controlledRegionId ?? '');
    expect(controlledRegion).toBeInTheDocument();
    expect(controlledRegion).not.toBeVisible();
  });

  it('expands the Healthy band when toggled', async () => {
    const user = userEvent.setup();
    render(<TriageView repos={repos} getRowData={getRowData} />);
    const toggle = screen.getByRole('button', { name: /healthy.*2/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('octo/healthy1')).toBeInTheDocument();
    expect(screen.getByText('octo/healthy2')).toBeInTheDocument();
  });
});

describe('TriageView states', () => {
  it('shows skeletons and a loading status on first load', () => {
    const { container } = render(<TriageView repos={[]} getRowData={() => ({})} loading />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders an alert with a retry control on error', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <TriageView
        repos={[]}
        getRowData={() => ({})}
        error="Could not load your repositories."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your repositories.');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a friendly empty state when the fleet has no repos', () => {
    render(<TriageView repos={[]} getRowData={() => ({})} />);
    expect(screen.getByText(/no repositories/i)).toBeInTheDocument();
  });

  it('shows an All clear state when the whole fleet is healthy', () => {
    const repos = [repo('octo/a'), repo('octo/b')];
    render(
      <TriageView
        repos={repos}
        getRowData={rowDataFor({ 'octo/a': HEALTHY, 'octo/b': HEALTHY })}
      />,
    );
    expect(screen.getByText(/all clear/i)).toBeInTheDocument();
    // No attention bands rendered
    expect(screen.queryByRole('heading', { name: /needs attention/i })).not.toBeInTheDocument();
  });

  it('does not show All clear while loaded repos are still resolving triage signals', () => {
    const repos = [repo('octo/a'), repo('octo/b')];

    render(<TriageView repos={repos} getRowData={() => ({})} loading />);

    expect(screen.queryByText(/all clear/i)).not.toBeInTheDocument();
    expect(screen.getByText(/loading fleet signals/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('surfaces settled actionable rows while the fleet is still loading', () => {
    const repos = [repo('octo/broken'), repo('octo/review')];
    render(
      <TriageView
        repos={repos}
        getRowData={rowDataFor({
          'octo/broken': FAILING_CI,
          'octo/review': REVIEW_REQUESTED,
        })}
        loading
      />,
    );

    expect(screen.queryByText(/loading fleet signals/i)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /waiting on me/i })).toBeInTheDocument();
    expect(screen.getByText('octo/broken')).toBeInTheDocument();
    expect(screen.getByText('octo/review')).toBeInTheDocument();
  });

  it('lists repos under the correct band with their owner/repo name', () => {
    render(<TriageView repos={[repo('octo/needy')]} getRowData={() => FAILING_CI} />);
    const region = screen.getByRole('region', { name: /needs attention/i });
    expect(within(region).getByText('octo/needy')).toBeInTheDocument();
  });
});
