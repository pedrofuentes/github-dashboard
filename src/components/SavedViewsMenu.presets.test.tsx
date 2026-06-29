import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_QUERY, type RepoFilterQueryV2 } from '../lib/repo-filter-query';
import type { SavedView } from '../lib/saved-views';
import type { CreateSavedViewInput, SavedViewMutationResult } from '../hooks/useSavedViews';
import { SavedViewsMenu } from './SavedViewsMenu';

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

const PRESETS: SavedView[] = [
  makeView({ id: 'preset:failing-ci', name: 'Failing CI', view: 'matrix' }),
  makeView({ id: 'preset:stale', name: 'Stale', view: 'grid' }),
];

function ok(view?: SavedView): SavedViewMutationResult {
  return { ok: true, ...(view !== undefined && { view }) };
}

interface HarnessProps {
  views?: SavedView[];
  presets?: SavedView[];
  currentFilter?: RepoFilterQueryV2;
  currentView?: SavedView['view'];
  onApply?: (view: SavedView) => void;
  onCreate?: (input: CreateSavedViewInput) => SavedViewMutationResult;
  onRename?: (id: string, name: string) => SavedViewMutationResult;
  onRemove?: (id: string) => void;
}

function renderMenu(props: HarnessProps = {}) {
  const onApply = props.onApply ?? vi.fn();
  const onCreate = props.onCreate ?? vi.fn(() => ok(makeView()));
  const onRename = props.onRename ?? vi.fn(() => ok());
  const onRemove = props.onRemove ?? vi.fn();
  render(
    <SavedViewsMenu
      views={props.views ?? []}
      presets={props.presets}
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

describe('SavedViewsMenu presets', () => {
  it('renders a presets section listing each preset', async () => {
    const user = userEvent.setup();
    renderMenu({ presets: PRESETS });

    await user.click(screen.getByRole('button', { name: /saved views/i }));

    const presetList = screen.getByRole('list', { name: /presets/i });
    const items = within(presetList).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(presetList).getByText('Failing CI')).toBeInTheDocument();
    expect(within(presetList).getByText('Stale')).toBeInTheDocument();
  });

  it('applies the clicked preset', async () => {
    const user = userEvent.setup();
    const { onApply } = renderMenu({ presets: PRESETS });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /apply preset failing ci/i }));

    expect(onApply).toHaveBeenCalledWith(PRESETS[0]);
  });

  it('does not expose rename or delete controls for presets', async () => {
    const user = userEvent.setup();
    renderMenu({ presets: PRESETS });

    await user.click(screen.getByRole('button', { name: /saved views/i }));

    expect(screen.queryByRole('button', { name: /rename.*failing ci/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete.*failing ci/i })).toBeNull();
  });

  it('renders no presets section when presets are omitted', async () => {
    const user = userEvent.setup();
    renderMenu({ views: [makeView({ id: 'u1', name: 'Mine' })] });

    await user.click(screen.getByRole('button', { name: /saved views/i }));

    expect(screen.queryByRole('list', { name: /presets/i })).toBeNull();
  });

  it('renders no presets section when presets is empty', async () => {
    const user = userEvent.setup();
    renderMenu({ presets: [] });

    await user.click(screen.getByRole('button', { name: /saved views/i }));

    expect(screen.queryByRole('list', { name: /presets/i })).toBeNull();
  });

  it('keeps presets and user views in separate labelled sections', async () => {
    const user = userEvent.setup();
    renderMenu({ views: [makeView({ id: 'u1', name: 'My scope' })], presets: PRESETS });

    await user.click(screen.getByRole('button', { name: /saved views/i }));

    const savedList = screen.getByRole('list', { name: /saved views/i });
    expect(within(savedList).getAllByRole('listitem')).toHaveLength(1);
    const presetList = screen.getByRole('list', { name: /presets/i });
    expect(within(presetList).getAllByRole('listitem')).toHaveLength(2);
  });
});
