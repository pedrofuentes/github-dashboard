import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { DashboardView } from './components/DashboardView';
import { DrillDownDrawer } from './components/DrillDownDrawer';
import { FleetGrid } from './components/FleetGrid';
import { InboxView } from './components/inbox/InboxView';
import { ThemeToggle } from './components/ThemeToggle';
import { TokenInput } from './components/TokenInput';
import { AuthProvider } from './hooks/AuthProvider';
import { useAuth } from './hooks/useAuth';
import { useInbox } from './hooks/useInbox';
import { useRepoSignals } from './hooks/useRepoSignals';
import { useRepos } from './hooks/useRepos';
import { loadViewPreference, saveViewPreference } from './lib/view-preference';
import type { FleetView } from './lib/view-preference';
import type { AuthUser } from './types/auth';
import type { Repo } from './types/fleet';

export function App(): ReactElement {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell(): ReactElement {
  const { status, user, token, forget } = useAuth();
  const authenticated = status === 'authenticated' && user !== null;

  return (
    <div className="min-h-screen bg-bg text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:font-medium focus:text-text focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus"
      >
        Skip to main content
      </a>
      <header className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">github-dashboard</h1>
            <p className="mt-2 text-text-muted">
              Fleet health for your GitHub repositories, at a glance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            {authenticated ? <AccountBar user={user} onForget={forget} /> : null}
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="overview-heading"
        className="mx-auto max-w-5xl px-6 pb-12 outline-none"
      >
        <h2 id="overview-heading" className="sr-only">
          Fleet overview
        </h2>
        {authenticated ? <FleetPanel token={token} /> : <TokenInput />}
      </main>
    </div>
  );
}

function FleetPanel({ token }: { token: string | null }): ReactElement {
  const { repos, status, error, reload } = useRepos(token);
  const { getRowData } = useRepoSignals(repos, token);
  const inbox = useInbox(repos, getRowData);
  const { markAllSeen } = inbox;
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [view, setView] = useState<FleetView>(loadViewPreference);
  const [editing, setEditing] = useState(false);

  // Advance the "last visited" watermark once per Inbox visit, but only after
  // the fleet has loaded so the hook's triage GC runs against the real live ids
  // (never an empty set, which would drop every read/dismissed mark). Leaving
  // the Inbox re-arms it so the next open re-stamps the watermark (AC-16).
  const inboxSeenRef = useRef(false);
  useEffect(() => {
    if (view !== 'inbox') {
      inboxSeenRef.current = false;
      return;
    }
    if (status === 'success' && !inboxSeenRef.current) {
      inboxSeenRef.current = true;
      markAllSeen();
    }
  }, [view, status, markAllSeen]);

  // Stable callbacks so the memoised grid rows keep shallow-equal props and do
  // not all re-render when the drawer opens or closes.
  const handleRepoActivate = useCallback((repo: Repo) => setSelectedRepo(repo), []);
  const handleCloseDrawer = useCallback(() => setSelectedRepo(null), []);
  const handleViewChange = useCallback((next: FleetView) => {
    setView(next);
    saveViewPreference(next);
    // Edit affordances only make sense on the dashboard; leave them when we go.
    if (next !== 'dashboard') {
      setEditing(false);
    }
  }, []);
  const handleToggleEditing = useCallback(() => setEditing((current) => !current), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ViewToggle view={view} onChange={handleViewChange} unreadCount={inbox.unreadCount} />
        {view === 'dashboard' ? (
          <CustomizeLayoutToggle editing={editing} onToggle={handleToggleEditing} />
        ) : null}
      </div>
      {view === 'dashboard' ? (
        <DashboardView
          repos={repos}
          getRowData={getRowData}
          onRepoActivate={handleRepoActivate}
          editing={editing}
          loading={status === 'loading'}
          error={status === 'error' ? error : null}
          onRetry={reload}
        />
      ) : view === 'inbox' ? (
        <InboxView
          inbox={inbox}
          repos={repos}
          loading={status === 'loading'}
          error={status === 'error' ? error : null}
          onRetry={reload}
        />
      ) : (
        <FleetGrid
          repos={repos}
          getRowData={getRowData}
          loading={status === 'loading'}
          error={status === 'error' ? error : null}
          onRetry={reload}
          onRepoActivate={handleRepoActivate}
        />
      )}
      {selectedRepo !== null ? (
        <DrillDownDrawer
          repo={selectedRepo}
          data={getRowData(selectedRepo)}
          onClose={handleCloseDrawer}
        />
      ) : null}
    </div>
  );
}

interface CustomizeLayoutToggleProps {
  editing: boolean;
  onToggle: () => void;
}

function CustomizeLayoutToggle({ editing, onToggle }: CustomizeLayoutToggleProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={editing}
      onClick={onToggle}
      className={
        editing
          ? 'rounded-md border border-accent-info bg-accent-info px-3 py-1 text-sm font-medium text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
          : 'rounded-md border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
      }
    >
      {editing ? 'Done customizing' : 'Customize layout'}
    </button>
  );
}

interface ViewToggleProps {
  view: FleetView;
  onChange: (view: FleetView) => void;
  unreadCount: number;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: FleetView; label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'inbox', label: 'Inbox' },
];

function ViewToggle({ view, onChange, unreadCount }: ViewToggleProps): ReactElement {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
    >
      {VIEW_OPTIONS.map((option) => {
        const isActive = view === option.value;
        const showBadge = option.value === 'inbox' && unreadCount > 0;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={
              isActive
                ? 'inline-flex items-center rounded px-3 py-1 text-sm font-medium bg-text text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                : 'inline-flex items-center rounded px-3 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
            }
          >
            {option.label}
            {showBadge ? (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent-info px-1.5 py-0.5 text-xs font-semibold leading-none text-surface">
                {unreadCount}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface AccountBarProps {
  user: AuthUser;
  onForget: () => void;
}

function AccountBar({ user, onForget }: AccountBarProps): ReactElement {
  return (
    <div className="flex items-center gap-3">
      {user.avatarUrl !== undefined ? (
        <img src={user.avatarUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold text-text-muted"
        >
          {user.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <p className="text-sm text-text-muted">{`Authenticated as ${user.login}`}</p>
      <button
        type="button"
        onClick={onForget}
        className="rounded border border-border-strong px-3 py-1 text-sm font-medium hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Forget token
      </button>
    </div>
  );
}
