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
});
