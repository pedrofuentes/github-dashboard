import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InboxFilters, InboxItemView, UseInboxResult } from '../../hooks/useInbox';
import type { Repo } from '../../types/fleet';
import { InboxView } from './InboxView';

function repo(nameWithOwner: string): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
}

const REPOS = [repo('octo/app'), repo('octo/api')];

function makeItem(overrides: Partial<InboxItemView> = {}): InboxItemView {
  return {
    id: 'ci:octo/app:1',
    kind: 'ci',
    repo: REPOS[0],
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

const DEFAULT_FILTERS: InboxFilters = {
  repos: [],
  kinds: [],
  unreadOnly: false,
  showDismissed: false,
};

function inboxResult(overrides: Partial<UseInboxResult> = {}): UseInboxResult {
  return {
    items: [],
    unreadCount: 0,
    filters: DEFAULT_FILTERS,
    setFilters: vi.fn(),
    markRead: vi.fn(),
    dismiss: vi.fn(),
    restore: vi.fn(),
    markAllRead: vi.fn(),
    markAllSeen: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InboxView wiring', () => {
  it('renders from the inbox view-model supplied as a prop (single shared instance)', () => {
    render(
      <InboxView
        inbox={inboxResult({ items: [makeItem({ title: 'Build broke' })], unreadCount: 2 })}
        repos={REPOS}
      />,
    );
    // The view is presentational: it reflects exactly the view-model App passes
    // in, so the toggle badge and the list can share one useInbox instance.
    expect(screen.getByText('Build broke')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/2 unread/i);
  });

  it('announces the fleet-wide unread count in a polite status region', () => {
    render(
      <InboxView inbox={inboxResult({ items: [makeItem()], unreadCount: 3 })} repos={REPOS} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/3 unread/i);
  });
});

describe('InboxView states (AC-13)', () => {
  it('shows a positive "all caught up" empty state when nothing matches and no filter is active', () => {
    render(
      <InboxView inbox={inboxResult({ items: [], filters: DEFAULT_FILTERS })} repos={REPOS} />,
    );

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByText(/no items match these filters/i)).toBeNull();
  });

  it('shows a distinct empty-filtered state with a clear-filters control when filters hide everything', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    render(
      <InboxView
        inbox={inboxResult({
          items: [],
          filters: { ...DEFAULT_FILTERS, unreadOnly: true },
          setFilters,
        })}
        repos={REPOS}
      />,
    );

    expect(screen.getByText(/no items match these filters/i)).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(setFilters).toHaveBeenCalledWith({
      repos: [],
      kinds: [],
      unreadOnly: false,
      showDismissed: false,
    });
  });

  it('renders a reduced-motion-friendly loading skeleton inherited from the fleet load', () => {
    const { container } = render(<InboxView inbox={inboxResult()} repos={REPOS} loading />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
    pulses.forEach((pulse) => expect(pulse).toHaveClass('motion-reduce:animate-none'));
    expect(screen.queryByText(/all caught up/i)).toBeNull();
  });

  it('renders an inherited error alert with a working retry control', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <InboxView inbox={inboxResult()} repos={REPOS} error="Network down" onRetry={onRetry} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/network down/i);
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the list of items when the inbox has matches', () => {
    render(
      <InboxView
        inbox={inboxResult({
          items: [makeItem({ id: 'a', title: 'Build broke' })],
          unreadCount: 1,
        })}
        repos={REPOS}
      />,
    );

    expect(screen.getByRole('list', { name: /inbox items/i })).toBeInTheDocument();
    expect(screen.getByText('Build broke')).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).toBeNull();
  });
});

describe('InboxView filters (AC-13 / §4.2)', () => {
  it('narrows by repository', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    render(<InboxView inbox={inboxResult({ items: [makeItem()], setFilters })} repos={REPOS} />);

    await user.selectOptions(screen.getByLabelText(/filter by repository/i), 'octo/api');
    expect(setFilters).toHaveBeenCalledWith({ repos: ['octo/api'] });
  });

  it('narrows by kind', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    render(<InboxView inbox={inboxResult({ items: [makeItem()], setFilters })} repos={REPOS} />);

    await user.selectOptions(screen.getByLabelText(/filter by kind/i), 'security');
    expect(setFilters).toHaveBeenCalledWith({ kinds: ['security'] });
  });

  it('toggles unread-only and show-dismissed', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    render(<InboxView inbox={inboxResult({ items: [makeItem()], setFilters })} repos={REPOS} />);

    await user.click(screen.getByRole('checkbox', { name: /unread only/i }));
    expect(setFilters).toHaveBeenCalledWith({ unreadOnly: true });

    await user.click(screen.getByRole('checkbox', { name: /show dismissed/i }));
    expect(setFilters).toHaveBeenCalledWith({ showDismissed: true });
  });
});

describe('InboxView triage announcements (AC-14)', () => {
  it('routes a row open (mark read) to the hook and announces it politely', async () => {
    const user = userEvent.setup();
    const markRead = vi.fn();
    const item = makeItem({ id: 'ci:octo/app:7', title: 'Build is red' });
    render(
      <InboxView inbox={inboxResult({ items: [item], unreadCount: 1, markRead })} repos={REPOS} />,
    );

    await user.click(screen.getByRole('link', { name: 'Build is red' }));
    expect(markRead).toHaveBeenCalledWith('ci:octo/app:7');
    expect(screen.getByText('Marked as read')).toBeInTheDocument();
  });

  it('routes a row dismiss to the hook and announces it politely', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    const item = makeItem({ id: 'ci:octo/app:9', title: 'Pipeline red' });
    render(
      <InboxView inbox={inboxResult({ items: [item], unreadCount: 1, dismiss })} repos={REPOS} />,
    );

    await user.click(screen.getByRole('button', { name: /dismiss pipeline red/i }));
    expect(dismiss).toHaveBeenCalledWith('ci:octo/app:9');
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });

  it('routes a row restore to the hook and announces it politely', async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    const item = makeItem({ id: 'ci:octo/app:8', title: 'Old failure', dismissed: true });
    render(
      <InboxView
        inbox={inboxResult({
          items: [item],
          filters: { ...DEFAULT_FILTERS, showDismissed: true },
          restore,
        })}
        repos={REPOS}
      />,
    );

    await user.click(screen.getByRole('button', { name: /restore old failure/i }));
    expect(restore).toHaveBeenCalledWith('ci:octo/app:8');
    expect(screen.getByText('Restored')).toBeInTheDocument();
  });

  it('re-announces a repeated triage action whose text is identical so screen readers hear it again (#245)', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    // Two already-read items: dismissing each announces the SAME "Dismissed"
    // string, and because both are read the unread `role="status"` count never
    // changes — so the polite triage region is the ONLY confirmation channel.
    const items = [
      makeItem({ id: 'ci:octo/app:1', title: 'First failure', read: true }),
      makeItem({ id: 'ci:octo/app:2', title: 'Second failure', read: true }),
    ];
    render(<InboxView inbox={inboxResult({ items, unreadCount: 0, dismiss })} repos={REPOS} />);

    await user.click(screen.getByRole('button', { name: /dismiss first failure/i }));
    const liveRegion = screen.getByText('Dismissed');
    const afterFirst = liveRegion.textContent;

    await user.click(screen.getByRole('button', { name: /dismiss second failure/i }));
    const afterSecond = liveRegion.textContent;

    // The human-readable confirmation must still be present...
    expect(liveRegion).toHaveTextContent('Dismissed');
    // ...but the live region's text must actually MUTATE between the two
    // identical announcements, or many screen readers skip the 2nd re-announce.
    expect(afterSecond).not.toEqual(afterFirst);
  });
});
