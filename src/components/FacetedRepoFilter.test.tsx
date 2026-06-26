import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const fuzzyRankByMock = vi.hoisted(() => ({
  actual: undefined as typeof import('../lib/fuzzy-match').fuzzyRankBy | undefined,
  spy: vi.fn(),
}));

vi.mock('../lib/fuzzy-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fuzzy-match')>();
  fuzzyRankByMock.actual = actual.fuzzyRankBy;
  fuzzyRankByMock.spy.mockImplementation(actual.fuzzyRankBy);
  return { ...actual, fuzzyRankBy: fuzzyRankByMock.spy };
});

import { FacetedRepoFilter } from './FacetedRepoFilter';
import { useRepoFilterQuery, type UseRepoFilterQueryResult } from '../hooks/useRepoFilterQuery';
import { EMPTY_QUERY } from '../lib/repo-filter-query';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

// Three repos with deterministic health bands:
//  - octo/alpha  → broken  (failing CI)
//  - octo/beta   → warning (review requested)
//  - acme/gamma  → healthy (no signals)
const REPOS: Repo[] = [repo('octo/alpha'), repo('octo/beta'), repo('acme/gamma', true)];

const ROW_DATA: Record<string, RepoSignalData> = {
  'octo/alpha': { ci: { status: 'ready', conclusion: 'failure', failingCount: 1 } },
  'octo/beta': { reviews: { status: 'ready', requestedCount: 1 } },
  'acme/gamma': {},
};

const getRowData: GetRowData = (r) => ROW_DATA[r.nameWithOwner] ?? {};

/** Renders the filter wired to a real {@link useRepoFilterQuery} over REPOS. */
function Harness(): ReactElement {
  const filter = useRepoFilterQuery(REPOS, getRowData);
  return <FacetedRepoFilter repos={REPOS} filter={filter} />;
}

function disclosure(): HTMLElement {
  return screen.getByRole('button', { name: /filter repositories/i });
}

function filterDouble(overrides: Partial<UseRepoFilterQueryResult> = {}): UseRepoFilterQueryResult {
  return {
    query: EMPTY_QUERY,
    derivedSelected: new Set(REPOS.map((r) => r.nameWithOwner)),
    isActive: false,
    setText: vi.fn(),
    toggleOwner: vi.fn(),
    toggleHealth: vi.fn(),
    toggleCi: vi.fn(),
    toggleSecurityGrade: vi.fn(),
    setSecurityMaxGrade: vi.fn(),
    toggleSecuritySeverity: vi.fn(),
    togglePullRequests: vi.fn(),
    toggleReviewsAwaitingMe: vi.fn(),
    toggleIssues: vi.fn(),
    toggleStale: vi.fn(),
    toggleVisibility: vi.fn(),
    setRepoSelection: vi.fn(),
    toggleRepoPin: vi.fn(),
    clearAll: vi.fn(),
    applyQuery: vi.fn(),
    availableOwners: [
      { owner: 'acme', count: 1 },
      { owner: 'octo', count: 2 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  if (fuzzyRankByMock.actual === undefined) {
    throw new Error('fuzzyRankBy mock was not initialized');
  }
  fuzzyRankByMock.spy.mockImplementation(fuzzyRankByMock.actual);
  fuzzyRankByMock.spy.mockClear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('FacetedRepoFilter', () => {
  it('summarizes scope as "All repositories" when inactive and toggles the panel open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const button = disclosure();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('All repositories')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const search = screen.getByRole('combobox', { name: /search repositories/i });
    expect(search).toBeInTheDocument();
    expect(search).toHaveFocus();
  });

  it('closes on Escape and returns focus to the disclosure button', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const button = disclosure();
    await user.click(button);
    expect(screen.getByRole('combobox', { name: /search repositories/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('filters the repo list via the search box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    const listbox = screen.getByRole('listbox', { name: /matching repositories/i });
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);

    await user.type(screen.getByRole('combobox', { name: /search repositories/i }), 'gamma');

    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(1));
    expect(within(listbox).getAllByRole('option')[0]).toHaveTextContent('acme/gamma');
  });

  it('toggles a repository pin from the search list with the keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    const listbox = screen.getByRole('listbox', { name: /matching repositories/i });
    // Every repo is selected while the query is inactive.
    for (const option of within(listbox).getAllByRole('option')) {
      expect(option).toHaveAttribute('aria-selected', 'true');
    }

    // Highlight the first option and pin it via Enter.
    const search = screen.getByRole('combobox', { name: /search repositories/i });
    await user.type(search, '{ArrowDown}{Enter}');

    // Pinning octo/alpha narrows the derived selection to just that repo.
    const optionFor = (name: string): HTMLElement =>
      within(listbox)
        .getAllByRole('option')
        .find((el) => el.textContent?.includes(name)) as HTMLElement;
    expect(optionFor('octo/alpha')).toHaveAttribute('aria-selected', 'true');
    expect(optionFor('octo/beta')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();
  });

  it('updates the summary when a facet checkbox is toggled', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    await user.click(screen.getByRole('checkbox', { name: /broken/i }));

    // Only octo/alpha is broken.
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();
  });

  it('removes a facet when its active chip is dismissed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    await user.click(screen.getByRole('checkbox', { name: /broken/i }));
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove .*broken.* filter/i }));

    expect(screen.getByText('All repositories')).toBeInTheDocument();
  });

  it('resets every active filter with Clear all', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    await user.click(screen.getByRole('checkbox', { name: /broken/i }));
    await user.click(screen.getByRole('checkbox', { name: /^octo/i }));
    expect(screen.queryByText('All repositories')).toBeNull();

    await user.click(screen.getByRole('button', { name: /clear all/i }));

    expect(screen.getByText('All repositories')).toBeInTheDocument();
  });

  it('announces the matched repository count via a polite live region', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    const live = screen.getByTestId('repo-filter-live');
    expect(live).toHaveTextContent(/3 repositories/i);

    await user.type(screen.getByRole('combobox', { name: /search repositories/i }), 'gamma');

    await waitFor(() => expect(live).toHaveTextContent(/1 repository/i));
  });

  it('shows an empty-state option when no repository matches the search', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    await user.type(screen.getByRole('combobox', { name: /search repositories/i }), 'zzzznope');

    const listbox = screen.getByRole('listbox', { name: /matching repositories/i });
    await waitFor(() =>
      expect(within(listbox).getByText(/no repositories match/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('repo-filter-live')).toHaveTextContent(/0 repositories/i);
  });

  it('scopes to a single owner via the owner facet', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // Two repos belong to octo, one to acme.
    await user.click(screen.getByRole('checkbox', { name: /^octo \(2\)/i }));

    expect(screen.getByText(/2 repos · 1 filter/i)).toBeInTheDocument();
  });

  it('selects and clears all owners with the bulk controls', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    await user.click(screen.getByRole('button', { name: /select all owners/i }));
    // All owners selected ⇒ every repo still matches (2 owners as chips).
    expect(screen.getByText(/3 repos · 2 filters/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^octo \(2\)/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^acme \(1\)/i })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /no owners/i }));
    expect(screen.getByText('All repositories')).toBeInTheDocument();
  });

  it('applies Select all owners as one bulk query update', async () => {
    const user = userEvent.setup();
    const filter = filterDouble();
    render(<FacetedRepoFilter repos={REPOS} filter={filter} />);
    await user.click(disclosure());

    await user.click(screen.getByRole('button', { name: /select all owners/i }));

    expect(filter.toggleOwner).not.toHaveBeenCalled();
    expect(filter.applyQuery).toHaveBeenCalledTimes(1);
    expect(filter.applyQuery).toHaveBeenCalledWith({
      ...EMPTY_QUERY,
      facets: { ...EMPTY_QUERY.facets, owners: ['acme', 'octo'] },
    });
  });

  it('applies No owners as one bulk query update', async () => {
    const user = userEvent.setup();
    const filter = filterDouble({
      query: {
        ...EMPTY_QUERY,
        facets: { ...EMPTY_QUERY.facets, owners: ['acme', 'octo'] },
      },
      isActive: true,
    });
    render(<FacetedRepoFilter repos={REPOS} filter={filter} />);
    await user.click(disclosure());

    await user.click(screen.getByRole('button', { name: /no owners/i }));

    expect(filter.toggleOwner).not.toHaveBeenCalled();
    expect(filter.applyQuery).toHaveBeenCalledTimes(1);
    expect(filter.applyQuery).toHaveBeenCalledWith({
      ...EMPTY_QUERY,
      facets: { ...EMPTY_QUERY.facets, owners: [] },
    });
  });

  it('debounces fuzzy ranking while search text changes', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      fireEvent.click(disclosure());
      const search = screen.getByRole('combobox', { name: /search repositories/i });
      const listbox = screen.getByRole('listbox', { name: /matching repositories/i });
      fuzzyRankByMock.spy.mockClear();

      fireEvent.change(search, { target: { value: 'g' } });
      fireEvent.change(search, { target: { value: 'ga' } });
      fireEvent.change(search, { target: { value: 'gam' } });

      expect(fuzzyRankByMock.spy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(fuzzyRankByMock.spy).toHaveBeenCalledTimes(1);
      const options = within(listbox).getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('acme/gamma');
    } finally {
      vi.useRealTimers();
    }
  });

  it('inverts the visible selection into an include pin set', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // No pins yet ⇒ everything is selected; inverting pins the complement (none).
    await user.click(screen.getByRole('combobox', { name: /search repositories/i }));
    await user.keyboard('{ArrowDown}{Enter}'); // pin octo/alpha (include mode)
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();

    // Inverting over the (all) visible repos now selects the other two.
    await user.click(screen.getByRole('button', { name: /invert visible/i }));
    expect(screen.getByText(/2 repos · 2 filters/i)).toBeInTheDocument();
  });

  it('toggles non-owner facets (visibility) and reflects them as chips', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // Only acme/gamma is private in the fixture.
    await user.click(screen.getByRole('checkbox', { name: /^private$/i }));
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove private filter/i })).toBeInTheDocument();
  });

  it('wraps ArrowUp navigation to the last option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    const search = screen.getByRole('combobox', { name: /search repositories/i });
    await user.click(search);
    // From the unset active index, ArrowUp wraps to the last repo; Enter pins it.
    await user.keyboard('{ArrowUp}{Enter}');

    const listbox = screen.getByRole('listbox');
    const lastOption = within(listbox)
      .getAllByRole('option')
      .find((el) => el.textContent?.includes('acme/gamma')) as HTMLElement;
    expect(lastOption).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();
  });

  it('closes when a pointer lands outside the panel', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <Harness />
      </div>,
    );
    await user.click(disclosure());
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'outside' }));

    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows zero-result state when filters are active but match no repos', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // Filter to private (only acme/gamma) then exclude it (0 repos).
    await user.click(screen.getByRole('checkbox', { name: /^private$/i }));
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();

    // Pin acme/gamma in include mode, then switch to exclude mode by toggling it off
    // from the currently selected set. Actually, let's use a simpler approach:
    // apply two contradictory filters (e.g., broken + healthy only).
    await user.click(screen.getByRole('checkbox', { name: /^broken$/i }));
    // Now we have private AND broken, which matches nothing (alpha is broken but public).
    expect(screen.getByText(/0 repos · 2 filters/i)).toBeInTheDocument();

    // Zero-result state should show a message and a Clear filters button.
    const zeroState = screen.getByTestId('zero-result-state');
    expect(zeroState).toHaveTextContent(/no repositories match these filters/i);
    const clearButton = within(zeroState).getByRole('button', { name: /clear filters/i });
    expect(clearButton).toBeInTheDocument();

    // Clicking Clear filters should reset to "All repositories".
    await user.click(clearButton);
    expect(screen.getByText('All repositories')).toBeInTheDocument();
  });

  it('does not show zero-result state when filters are inactive', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // No filters active ⇒ no zero-result state even though we could show 3 repos.
    expect(screen.queryByTestId('zero-result-state')).toBeNull();
  });

  it('persists recent filters when a query becomes active', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // Apply a filter (broken) to make the query active.
    await user.click(screen.getByRole('checkbox', { name: /^broken$/i }));
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();

    // Close and reopen the popover — the recent filter should appear.
    await user.keyboard('{Escape}');
    await user.click(disclosure());

    const recentsGroup = screen.getByRole('group', { name: /recent filters/i });
    expect(recentsGroup).toBeInTheDocument();
    expect(within(recentsGroup).getByRole('button', { name: /broken/i })).toBeInTheDocument();
  });

  it('applies a recent filter when clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // Apply and clear a filter to record it as recent.
    await user.click(screen.getByRole('checkbox', { name: /^healthy$/i }));
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(screen.getByText('All repositories')).toBeInTheDocument();

    // Close and reopen — the recent filter should be listed.
    await user.keyboard('{Escape}');
    await user.click(disclosure());

    const recentsGroup = screen.getByRole('group', { name: /recent filters/i });
    const recentButton = within(recentsGroup).getByRole('button', { name: /healthy/i });
    await user.click(recentButton);

    // The healthy filter should now be re-applied.
    expect(screen.getByText(/1 repo · 1 filter/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^healthy$/i })).toBeChecked();
  });

  it('caps recent filters at 5 and shows most recent first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // Apply 6 different filters one by one (clear between each).
    const facets = [/^broken$/i, /^warning$/i, /^healthy$/i, /^private$/i, /^public$/i, /^octo/i];
    for (const name of facets) {
      const checkbox = screen.getByRole('checkbox', { name });
      await user.click(checkbox);
      await user.click(screen.getByRole('button', { name: /clear all/i }));
    }

    // Close and reopen — recent filters should show only the last 5.
    await user.keyboard('{Escape}');
    await user.click(disclosure());

    const recentsGroup = screen.getByRole('group', { name: /recent filters/i });
    const buttons = within(recentsGroup).getAllByRole('button');
    expect(buttons).toHaveLength(5);

    // Most recent (octo owner) should be first.
    expect(buttons[0]).toHaveTextContent(/octo/i);
    // Oldest (broken) should NOT appear.
    expect(within(recentsGroup).queryByRole('button', { name: /broken/i })).toBeNull();
  });

  it('does not show recent filters group when list is empty', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    // No filters applied yet ⇒ no recent filters group.
    expect(screen.queryByRole('group', { name: /recent filters/i })).toBeNull();
  });
});

// #469 — WCAG 2.4.7 Focus Visible: arrowing past the ~7 visible rows of the
// max-h-40 listbox moves the active descendant (the only visible keyboard-focus
// indicator) out of view. These tests assert the scroll *contract* (jsdom has
// no layout): scrollIntoView({ block: 'nearest' }) fires on the CORRECT active
// option, and never when the panel is closed or no option is active.
describe('FacetedRepoFilter active-option visibility (WCAG 2.4.7)', () => {
  function searchBox(): HTMLElement {
    return screen.getByRole('combobox', { name: /search repositories/i });
  }

  it('scrolls the active repository option into view as the highlight moves', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Harness />);
    await user.click(disclosure());
    const listbox = screen.getByRole('listbox', { name: /matching repositories/i });
    scrollSpy.mockClear();

    await user.type(searchBox(), '{ArrowDown}{ArrowDown}');

    const active = within(listbox).getAllByRole('option')[1];
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollSpy.mock.instances[scrollSpy.mock.instances.length - 1]).toBe(active);
  });

  it('does not scroll while the panel is closed', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(<Harness />);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('does not scroll when the panel opens with no active option', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Harness />);

    await user.click(disclosure());

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
