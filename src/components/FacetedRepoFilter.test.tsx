import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { FacetedRepoFilter } from './FacetedRepoFilter';
import { useRepoFilterQuery } from '../hooks/useRepoFilterQuery';
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
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

    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('acme/gamma');
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

    expect(live).toHaveTextContent(/1 repository/i);
  });

  it('shows an empty-state option when no repository matches the search', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(disclosure());

    await user.type(screen.getByRole('combobox', { name: /search repositories/i }), 'zzzznope');

    const listbox = screen.getByRole('listbox', { name: /matching repositories/i });
    expect(within(listbox).getByText(/no repositories match/i)).toBeInTheDocument();
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
