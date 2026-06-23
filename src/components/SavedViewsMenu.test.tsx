import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_QUERY, type RepoFilterQueryV2 } from '../lib/repo-filter-query';
import { MAX_VIEW_NAME_LENGTH, type SavedView } from '../lib/saved-views';
import type { CreateSavedViewInput, SavedViewMutationResult } from '../hooks/useSavedViews';
import { SavedViewsMenu } from './SavedViewsMenu';

const ALT_QUERY: RepoFilterQueryV2 = {
  version: 2,
  text: 'octo',
  repoSelection: { mode: 'all', names: [] },
  facets: {
    owners: ['octo'],
    health: [],
    ci: [],
    security: { grades: [], severities: [] },
    pullRequests: [],
    reviews: [],
    issues: [],
    stale: [],
    visibility: [],
  },
};

function makeView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: 'view-1',
    name: 'Broken CI',
    view: 'triage',
    filter: EMPTY_QUERY,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface HarnessProps {
  views?: SavedView[];
  currentFilter?: RepoFilterQueryV2;
  currentView?: SavedView['view'];
  onApply?: (view: SavedView) => void;
  onCreate?: (input: CreateSavedViewInput) => SavedViewMutationResult;
  onRename?: (id: string, name: string) => SavedViewMutationResult;
  onRemove?: (id: string) => void;
}

function ok(view?: SavedView): SavedViewMutationResult {
  return { ok: true, ...(view !== undefined && { view }) };
}

function renderMenu(props: HarnessProps = {}) {
  const onApply = props.onApply ?? vi.fn();
  const onCreate = props.onCreate ?? vi.fn(() => ok(makeView()));
  const onRename = props.onRename ?? vi.fn(() => ok());
  const onRemove = props.onRemove ?? vi.fn();
  render(
    <SavedViewsMenu
      views={props.views ?? []}
      currentFilter={props.currentFilter ?? EMPTY_QUERY}
      currentView={props.currentView ?? 'matrix'}
      onApply={onApply}
      onCreate={onCreate}
      onRename={onRename}
      onRemove={onRemove}
    />,
  );
  return { onApply, onCreate, onRename, onRemove };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SavedViewsMenu', () => {
  it('exposes a labelled disclosure button that toggles the panel', async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole('button', { name: /saved views/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the empty state when there are no saved views', async () => {
    const user = userEvent.setup();
    renderMenu({ views: [] });
    await user.click(screen.getByRole('button', { name: /saved views/i }));
    expect(screen.getByText(/no saved views yet/i)).toBeInTheDocument();
  });

  it('lists saved views and applies one when selected', async () => {
    const user = userEvent.setup();
    const view = makeView({ id: 'v9', name: 'Security alerts' });
    const { onApply } = renderMenu({ views: [view] });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /apply saved view security alerts/i }));

    expect(onApply).toHaveBeenCalledWith(view);
  });

  it('captures the current filter and view when saving a new view', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderMenu({ currentFilter: ALT_QUERY, currentView: 'grid' });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.type(screen.getByLabelText(/name this view/i), 'My scope');
    await user.click(screen.getByRole('button', { name: /^save current as view$/i }));

    expect(onCreate).toHaveBeenCalledWith({
      name: 'My scope',
      view: 'grid',
      filter: ALT_QUERY,
    });
  });

  it('shows inline feedback and does not clear input when create is rejected', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(
      () => ({ ok: false, error: 'Name is required.' }) as SavedViewMutationResult,
    );
    renderMenu({ onCreate });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.type(screen.getByLabelText(/name this view/i), 'x');
    await user.click(screen.getByRole('button', { name: /^save current as view$/i }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
  });

  it('does not call onCreate for a blank name and shows feedback', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderMenu();

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /^save current as view$/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not call onCreate for an over-long name and shows feedback', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderMenu();

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.type(screen.getByLabelText(/name this view/i), 'a'.repeat(MAX_VIEW_NAME_LENGTH + 1));
    await user.click(screen.getByRole('button', { name: /^save current as view$/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renames a view through the inline rename form', async () => {
    const user = userEvent.setup();
    const view = makeView({ id: 'v3', name: 'Old name' });
    const { onRename } = renderMenu({ views: [view] });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /rename saved view old name/i }));

    const input = screen.getByLabelText(/rename view/i);
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: /^save name$/i }));

    expect(onRename).toHaveBeenCalledWith('v3', 'New name');
  });

  it('requires confirmation before removing a view', async () => {
    const user = userEvent.setup();
    const view = makeView({ id: 'v4', name: 'Disposable' });
    const { onRemove } = renderMenu({ views: [view] });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /delete saved view disposable/i }));
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /confirm delete/i }));
    expect(onRemove).toHaveBeenCalledWith('v4');
  });

  it('closes on Escape and returns focus to the disclosure button', async () => {
    const user = userEvent.setup();
    renderMenu({ views: [makeView()] });
    const button = screen.getByRole('button', { name: /saved views/i });

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'));
    expect(button).toHaveFocus();
  });

  it('renders the saved views inside a list', async () => {
    const user = userEvent.setup();
    renderMenu({ views: [makeView({ id: 'a', name: 'One' }), makeView({ id: 'b', name: 'Two' })] });
    await user.click(screen.getByRole('button', { name: /saved views/i }));
    const list = screen.getByRole('list', { name: /saved views/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});
