import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InboxItemView } from '../../hooks/useInbox';
import type { Repo } from '../../types/fleet';
import { InboxList } from './InboxList';

function repo(nameWithOwner: string): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
}

function makeItem(overrides: Partial<InboxItemView> = {}): InboxItemView {
  return {
    id: 'ci:octo/app:1',
    kind: 'ci',
    repo: repo('octo/app'),
    title: 'CI failing — build.yml',
    url: 'https://github.com/octo/app/actions/runs/1',
    timestamp: '2026-06-20T12:00:00.000Z',
    accent: 'failure',
    read: false,
    dismissed: false,
    isNew: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InboxList', () => {
  it('renders an accessible list with one row per item, preserving order', () => {
    const items = [
      makeItem({ id: 'a', title: 'Newest item' }),
      makeItem({ id: 'b', title: 'Middle item' }),
      makeItem({ id: 'c', title: 'Oldest item' }),
    ];
    render(
      <InboxList items={items} onMarkRead={vi.fn()} onDismiss={vi.fn()} onRestore={vi.fn()} />,
    );

    const list = screen.getByRole('list', { name: /inbox items/i });
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(list).toContainElement(rows[0]);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Newest item'),
      expect.stringContaining('Middle item'),
      expect.stringContaining('Oldest item'),
    ]);
  });

  it('renders an empty list (no rows) when there are no items', () => {
    render(<InboxList items={[]} onMarkRead={vi.fn()} onDismiss={vi.fn()} onRestore={vi.fn()} />);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('forwards triage callbacks from the right row', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const items = [makeItem({ id: 'a', title: 'Alpha' }), makeItem({ id: 'b', title: 'Bravo' })];
    render(
      <InboxList items={items} onMarkRead={vi.fn()} onDismiss={onDismiss} onRestore={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /dismiss bravo/i }));
    expect(onDismiss).toHaveBeenCalledWith('b');
  });
});

describe('InboxList selection threading', () => {
  it('passes selection state + onToggleSelect to each row when provided', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    const items = [makeItem({ id: 'a', title: 'Alpha' }), makeItem({ id: 'b', title: 'Bravo' })];
    render(
      <InboxList
        items={items}
        selectedIds={new Set(['a'])}
        onToggleSelect={onToggleSelect}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox', { name: /select alpha/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /select bravo/i })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /select bravo/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('b');
  });

  it('renders no checkboxes when the selection props are omitted', () => {
    render(
      <InboxList
        items={[makeItem()]}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
