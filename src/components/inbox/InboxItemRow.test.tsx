import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRepoOwnerStoreForTests } from '../../hooks/useRepoOwner';
import type { InboxItemView } from '../../hooks/useInbox';
import type { Repo } from '../../types/fleet';
import { InboxItemRow } from './InboxItemRow';

const REPO_OWNER_KEY = 'fleet:repo-owner';

function repo(nameWithOwner = 'octo/app'): Repo {
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
    id: 'ci:octo/app:123',
    kind: 'ci',
    repo: repo(),
    title: 'CI failing — build.yml',
    url: 'https://github.com/octo/app/actions/runs/123',
    timestamp: '2026-06-20T12:00:00.000Z',
    accent: 'failure',
    read: false,
    dismissed: false,
    isNew: false,
    ...overrides,
  };
}

function renderRow(item: InboxItemView) {
  const onMarkRead = vi.fn();
  const onDismiss = vi.fn();
  const onRestore = vi.fn();
  const utils = render(
    <ul>
      <InboxItemRow
        item={item}
        onMarkRead={onMarkRead}
        onDismiss={onDismiss}
        onRestore={onRestore}
      />
    </ul>,
  );
  return { ...utils, onMarkRead, onDismiss, onRestore };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
  __resetRepoOwnerStoreForTests();
});

describe('InboxItemRow content', () => {
  it('renders the item as a list row with title, repo and a machine-readable timestamp', () => {
    const item = makeItem();
    const { container } = renderRow(item);

    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(screen.getByText(item.title)).toBeInTheDocument();
    expect(screen.getByText('octo/app')).toBeInTheDocument();

    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute('datetime', item.timestamp);
  });

  it('renders a kind/severity glyph + text label so meaning is not carried by colour alone', () => {
    const row = renderRow(makeItem({ kind: 'ci', accent: 'failure' }));
    // The text label is the accessible carrier (a non-colour channel)...
    expect(within(row.getByRole('listitem')).getByText('CI failing')).toBeInTheDocument();
    // ...reinforced visually by a (decorative) glyph.
    expect(row.getByRole('listitem').querySelector('svg')).not.toBeNull();
  });

  it('folds security severity into the kind label', () => {
    renderRow(
      makeItem({
        id: 'security:octo/app:dependabot:1',
        kind: 'security',
        severity: 'critical',
        accent: 'failure',
        title: 'Vulnerable dependency',
      }),
    );
    expect(screen.getByText(/security alert · critical/i)).toBeInTheDocument();
  });
});

describe('InboxItemRow GitHub link (origin-gated)', () => {
  it('renders the title as a GitHub link opening in a new, isolated tab', () => {
    const item = makeItem();
    renderRow(item);

    const link = screen.getByRole('link', { name: /CI failing/i });
    expect(link).toHaveAttribute('href', item.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
  });

  it('degrades a non-GitHub url to inert text (never a live off-origin link)', () => {
    renderRow(makeItem({ url: 'https://evil.example.com/pwn', title: 'Sneaky link' }));

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Sneaky link')).toBeInTheDocument();
  });
});

describe('InboxItemRow unread indication (not colour-only)', () => {
  it('marks an unread item with an "Unread" text label and bold weight', () => {
    renderRow(makeItem({ read: false }));

    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /CI failing/i })).toHaveClass('font-semibold');
  });

  it('drops the unread label and bold weight once read', () => {
    renderRow(makeItem({ read: true }));

    expect(screen.queryByText('Unread')).toBeNull();
    expect(screen.getByRole('link', { name: /CI failing/i })).not.toHaveClass('font-semibold');
  });
});

describe('InboxItemRow keyboard + pointer activation', () => {
  it('marks the item read when the link is clicked', async () => {
    const user = userEvent.setup();
    const item = makeItem();
    const { onMarkRead } = renderRow(item);

    await user.click(screen.getByRole('link', { name: /CI failing/i }));
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onMarkRead).toHaveBeenCalledWith(item.id);
  });

  it('is reachable by Tab and activates with Enter and Space', async () => {
    const user = userEvent.setup();
    const item = makeItem();
    const { onMarkRead } = renderRow(item);
    const link = screen.getByRole('link', { name: /CI failing/i });

    await user.tab();
    expect(link).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onMarkRead).toHaveBeenCalledWith(item.id);

    onMarkRead.mockClear();
    link.focus();
    await user.keyboard(' ');
    expect(onMarkRead).toHaveBeenCalledWith(item.id);
  });

  it('marks read exactly once on Enter — no double-activate via keydown + click (#246)', async () => {
    const user = userEvent.setup();
    const item = makeItem();
    const { onMarkRead } = renderRow(item);
    const link = screen.getByRole('link', { name: /CI failing/i });

    link.focus();
    await user.keyboard('{Enter}');

    // Enter triggers the anchor's native click (which marks read). Handling Enter
    // in onKeyDown too would mark read a second time — exactly one activation.
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onMarkRead).toHaveBeenCalledWith(item.id);
  });

  it('leaves Enter to native activation: onKeyDown does not mark read or preventDefault (#246)', () => {
    const item = makeItem();
    const { onMarkRead } = renderRow(item);
    const link = screen.getByRole('link', { name: /CI failing/i });

    // A bare keydown carries no native click; the row must NOT treat Enter as an
    // activation (that is the browser's job via the click), nor swallow it.
    const event = createEvent.keyDown(link, { key: 'Enter' });
    fireEvent(link, event);

    expect(onMarkRead).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('handles Space itself: marks read once and prevents the page scroll (#246)', () => {
    const item = makeItem();
    const { onMarkRead } = renderRow(item);
    const link = screen.getByRole('link', { name: /CI failing/i });

    // Anchors do not natively activate on Space (they scroll), so the row marks
    // read and prevents the default scroll.
    const event = createEvent.keyDown(link, { key: ' ' });
    fireEvent(link, event);

    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onMarkRead).toHaveBeenCalledWith(item.id);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('InboxItemRow triage controls', () => {
  it('exposes a labelled Dismiss button that triages by id', async () => {
    const user = userEvent.setup();
    const item = makeItem();
    const { onDismiss } = renderRow(item);

    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismiss);
    expect(onDismiss).toHaveBeenCalledWith(item.id);
  });

  it('swaps Dismiss for a Restore button when the item is already dismissed', async () => {
    const user = userEvent.setup();
    const item = makeItem({ dismissed: true });
    const { onRestore } = renderRow(item);

    expect(screen.queryByRole('button', { name: /^dismiss/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /restore/i }));
    expect(onRestore).toHaveBeenCalledWith(item.id);
  });
});

describe('InboxItemRow accent + reduced motion', () => {
  it('paints a decorative accent driven by item.accent (hidden from assistive tech)', () => {
    const { container } = renderRow(makeItem({ accent: 'failure' }));
    const bar = container.querySelector('[data-tone="failure"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('gates row transitions behind motion-safe and flags new items without animation', () => {
    const { container } = renderRow(makeItem({ isNew: true }));
    const row = container.querySelector('li');
    expect(row?.className).toContain('motion-safe:');
    // "New since last visit" is a static text badge, not a colour-only/animated cue.
    expect(
      within(container.querySelector('li') as HTMLElement).getByText(/new/i),
    ).toBeInTheDocument();
  });
});

describe('InboxItemRow selection (multi-select, optional)', () => {
  it('renders no selection checkbox when onToggleSelect is omitted (DOM unchanged)', () => {
    renderRow(makeItem());
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('renders a labelled checkbox reflecting `selected` and toggling by id when onToggleSelect is provided', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    const item = makeItem();
    render(
      <ul>
        <InboxItemRow
          item={item}
          selected={false}
          onToggleSelect={onToggleSelect}
          onMarkRead={vi.fn()}
          onDismiss={vi.fn()}
          onRestore={vi.fn()}
        />
      </ul>,
    );

    const checkbox = screen.getByRole('checkbox', { name: /select ci failing/i });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith(item.id);
  });

  it('reflects selected=true as a checked checkbox', () => {
    render(
      <ul>
        <InboxItemRow
          item={makeItem()}
          selected
          onToggleSelect={vi.fn()}
          onMarkRead={vi.fn()}
          onDismiss={vi.fn()}
          onRestore={vi.fn()}
        />
      </ul>,
    );

    expect(screen.getByRole('checkbox', { name: /select ci failing/i })).toBeChecked();
  });
});

describe('InboxItemRow repo-owner display preference', () => {
  it('hides the owner in the visible repo label when "hide", keeping the full name in the title', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    renderRow(makeItem({ repo: repo('octo/api-server') }));
    const repoLabel = screen.getByText('api-server');
    expect(repoLabel).toHaveAttribute('title', 'octo/api-server');
  });

  it('shows the full owner/repo (with a full-name title) in the visible label when "show"', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'show');
    renderRow(makeItem({ repo: repo('octo/api-server') }));
    const repoLabel = screen.getByText('octo/api-server');
    expect(repoLabel).toHaveAttribute('title', 'octo/api-server');
  });
});
