import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboxFilters, InboxItemView, UseInboxResult } from '../../hooks/useInbox';
import { useInbox } from '../../hooks/useInbox';
import type { GetRowData, Repo } from '../../types/fleet';
import { InboxView } from './InboxView';

vi.mock('../../hooks/useInbox', () => ({ useInbox: vi.fn() }));

const mockedUseInbox = vi.mocked(useInbox);

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
const getRowData: GetRowData = () => ({});

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

beforeEach(() => {
  mockedUseInbox.mockReset();
  mockedUseInbox.mockReturnValue(inboxResult());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InboxView wiring', () => {
  it('drives the view from useInbox(repos, getRowData) so App can supply the fleet seam', () => {
    render(<InboxView repos={REPOS} getRowData={getRowData} />);
    expect(mockedUseInbox).toHaveBeenCalledWith(REPOS, getRowData);
  });

  it('announces the fleet-wide unread count in a polite status region', () => {
    mockedUseInbox.mockReturnValue(inboxResult({ items: [makeItem()], unreadCount: 3 }));
    render(<InboxView repos={REPOS} getRowData={getRowData} />);
    expect(screen.getByRole('status')).toHaveTextContent(/3 unread/i);
  });
});

describe('InboxView states (AC-13)', () => {
  it('shows a positive "all caught up" empty state when nothing matches and no filter is active', () => {
    mockedUseInbox.mockReturnValue(inboxResult({ items: [], filters: DEFAULT_FILTERS }));
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByText(/no items match these filters/i)).toBeNull();
  });

  it('shows a distinct empty-filtered state with a clear-filters control when filters hide everything', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    mockedUseInbox.mockReturnValue(
      inboxResult({ items: [], filters: { ...DEFAULT_FILTERS, unreadOnly: true }, setFilters }),
    );
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

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
    const { container } = render(<InboxView repos={REPOS} getRowData={getRowData} loading />);

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
      <InboxView repos={REPOS} getRowData={getRowData} error="Network down" onRetry={onRetry} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/network down/i);
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the list of items when the inbox has matches', () => {
    mockedUseInbox.mockReturnValue(
      inboxResult({ items: [makeItem({ id: 'a', title: 'Build broke' })], unreadCount: 1 }),
    );
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

    expect(screen.getByRole('list', { name: /inbox items/i })).toBeInTheDocument();
    expect(screen.getByText('Build broke')).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).toBeNull();
  });
});

describe('InboxView filters (AC-13 / §4.2)', () => {
  it('narrows by repository', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    mockedUseInbox.mockReturnValue(inboxResult({ items: [makeItem()], setFilters }));
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

    await user.selectOptions(screen.getByLabelText(/filter by repository/i), 'octo/api');
    expect(setFilters).toHaveBeenCalledWith({ repos: ['octo/api'] });
  });

  it('narrows by kind', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    mockedUseInbox.mockReturnValue(inboxResult({ items: [makeItem()], setFilters }));
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

    await user.selectOptions(screen.getByLabelText(/filter by kind/i), 'security');
    expect(setFilters).toHaveBeenCalledWith({ kinds: ['security'] });
  });

  it('toggles unread-only and show-dismissed', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    mockedUseInbox.mockReturnValue(inboxResult({ items: [makeItem()], setFilters }));
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

    await user.click(screen.getByRole('checkbox', { name: /unread only/i }));
    expect(setFilters).toHaveBeenCalledWith({ unreadOnly: true });

    await user.click(screen.getByRole('checkbox', { name: /show dismissed/i }));
    expect(setFilters).toHaveBeenCalledWith({ showDismissed: true });
  });
});

describe('InboxView triage announcements (AC-14)', () => {
  it('routes a row dismiss to the hook and announces it politely', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    const item = makeItem({ id: 'ci:octo/app:9', title: 'Pipeline red' });
    mockedUseInbox.mockReturnValue(inboxResult({ items: [item], unreadCount: 1, dismiss }));
    render(<InboxView repos={REPOS} getRowData={getRowData} />);

    await user.click(screen.getByRole('button', { name: /dismiss pipeline red/i }));
    expect(dismiss).toHaveBeenCalledWith('ci:octo/app:9');
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });
});
