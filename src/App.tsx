import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { CustomizePanel } from './components/CustomizePanel';
import { DashboardView } from './components/DashboardView';
import { DefaultViewToggle } from './components/DefaultViewToggle';
import { DensityToggle } from './components/DensityToggle';
import { DrillDownDrawer } from './components/DrillDownDrawer';
import { FacetedRepoFilter } from './components/FacetedRepoFilter';
import { FleetGrid } from './components/FleetGrid';
import { FleetMatrix } from './components/FleetMatrix';
import { InboxView } from './components/inbox/InboxView';
import { ThemeToggle } from './components/ThemeToggle';
import { TokenInput } from './components/TokenInput';
import { AuthProvider } from './hooks/AuthProvider';
import { FleetUiStateProvider } from './hooks/FleetUiStateProvider';
import { useAliases } from './hooks/useAliases';
import { useAuth } from './hooks/useAuth';
import { useDashboardLayout } from './hooks/useDashboardLayout';
import { useInbox } from './hooks/useInbox';
import { useRepoFilterQuery } from './hooks/useRepoFilterQuery';
import { useRepoSignals } from './hooks/useRepoSignals';
import { useRepos } from './hooks/useRepos';
import { loadDefaultView, saveDefaultView } from './lib/default-view-preference';
import type { FleetView } from './lib/view-preference';
import type { AuthUser } from './types/auth';
import type { Repo, RepoSignalData, SignalStatus } from './types/fleet';

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
            <DensityToggle />
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

/** The per-repo signal slots populated asynchronously after the repo list loads. */
const SIGNAL_KEYS = ['ci', 'security', 'reviews', 'pullRequests', 'issues', 'stale'] as const;

/** Signal statuses that mean a slice has finished loading (settled, not in-flight). */
const RESOLVED_SIGNAL_STATUSES = new Set<SignalStatus>(['ready', 'error']);

/**
 * Whether a repo's signal data has settled — `true` only once **every** slice
 * has settled (`ready`/`error`). While any slice is still absent or `loading`
 * the derived inbox for that repo is incomplete: ids from the not-yet-loaded
 * slices are missing from the live set, so advancing the watermark (and pruning
 * triage against that partial set) would wrongly GC their read/dismissed marks.
 * A failed fetch becomes `error`, which counts as settled, so this still becomes
 * true eventually — there is no permanent stall on a slice that never loads.
 */
function repoSignalsResolved(data: RepoSignalData): boolean {
  return SIGNAL_KEYS.every((key) => {
    const slice = data[key];
    return slice !== undefined && RESOLVED_SIGNAL_STATUSES.has(slice.status);
  });
}

function FleetPanel({ token }: { token: string | null }): ReactElement {
  const { repos, status, error, reload } = useRepos(token);
  const { getRowData } = useRepoSignals(repos, token);
  // Lifted ONCE here (red-team B-1): the SAME layout instance drives both the
  // DashboardView grid and the sibling CustomizePanel, so the tile picker and
  // the grid never desync. Aliases + repo filter are owned alongside it.
  const { layout, setLayout, reset } = useDashboardLayout(repos);
  const aliases = useAliases(repos);
  const filter = useRepoFilterQuery(repos, getRowData);
  const inbox = useInbox(repos, getRowData);
  const { markAllSeen } = inbox;
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [view, setView] = useState<FleetView>(loadDefaultView);
  const [defaultView, setDefaultView] = useState<FleetView>(loadDefaultView);
  const [editing, setEditing] = useState(false);

  // The per-repo signals load asynchronously after the repo list resolves, so a
  // `status === 'success'` render can still have an incomplete derived inbox.
  // Treat the fleet as settled only once every repo has every signal slice
  // resolved, so the live ids the watermark GC runs against are complete — a repo
  // with even one slice still loading would otherwise prune triage for the ids of
  // its not-yet-loaded slices.
  const signalsResolved = useMemo(
    () => repos.every((repo) => repoSignalsResolved(getRowData(repo))),
    [repos, getRowData],
  );

  // The matrix and the dashboard both honour the active faceted filter. When the
  // filter narrows the fleet, the matrix renders ONLY the matching repos; with
  // no active filter it shows the whole fleet. Memoised so the matrix's own
  // worst-first model only recomputes when the fleet or selection changes.
  const matrixRepos = useMemo(
    () =>
      filter.isActive
        ? repos.filter((repo) => filter.derivedSelected.has(repo.nameWithOwner))
        : repos,
    [repos, filter.isActive, filter.derivedSelected],
  );

  // Advance the "last visited" watermark once per Inbox visit, but only after the
  // signals have settled so the hook's triage GC runs against the real live ids
  // (never the transiently-empty set of the load window, which would drop every
  // read/dismissed mark). Leaving the Inbox re-arms it so the next open re-stamps
  // the watermark (AC-16).
  const inboxSeenRef = useRef(false);
  useEffect(() => {
    if (view !== 'inbox') {
      inboxSeenRef.current = false;
      return;
    }
    if (status === 'success' && signalsResolved && !inboxSeenRef.current) {
      inboxSeenRef.current = true;
      markAllSeen();
    }
  }, [view, status, signalsResolved, markAllSeen]);

  // Stable callbacks so the memoised grid rows keep shallow-equal props and do
  // not all re-render when the drawer opens or closes.
  const handleRepoActivate = useCallback((repo: Repo) => setSelectedRepo(repo), []);
  const handleCloseDrawer = useCallback(() => setSelectedRepo(null), []);
  const handleViewChange = useCallback((next: FleetView) => {
    setView(next);
    // Edit affordances only make sense on the dashboard; leave them when we go.
    if (next !== 'dashboard') {
      setEditing(false);
    }
  }, []);
  const handleDefaultViewChange = useCallback((next: FleetView) => {
    saveDefaultView(next);
    setDefaultView(next);
    setView(next);
    if (next !== 'dashboard') {
      setEditing(false);
    }
  }, []);
  const handleToggleEditing = useCallback(() => setEditing((current) => !current), []);
  // Closing the CustomizePanel (Esc, backdrop, ✕) leaves edit mode, which also
  // unmounts the panel via the `editing` coupling and returns focus to the opener.
  const handleCloseCustomize = useCallback(() => setEditing(false), []);

  return (
    <FleetUiStateProvider>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={handleViewChange} unreadCount={inbox.unreadCount} />
          <DefaultViewToggle value={defaultView} onChange={handleDefaultViewChange} />
          {view === 'dashboard' ? (
            <>
              <FacetedRepoFilter repos={repos} filter={filter} />
              <CustomizeLayoutToggle editing={editing} onToggle={handleToggleEditing} />
            </>
          ) : view === 'matrix' ? (
            <FacetedRepoFilter repos={repos} filter={filter} />
          ) : null}
        </div>
        {view === 'matrix' ? (
          <FleetMatrix
            repos={matrixRepos}
            getRowData={getRowData}
            onRepoActivate={handleRepoActivate}
            loading={status === 'loading'}
            error={status === 'error' ? error : null}
            onRetry={reload}
          />
        ) : view === 'dashboard' ? (
          <>
            <DashboardView
              repos={repos}
              getRowData={getRowData}
              onRepoActivate={handleRepoActivate}
              editing={editing}
              layout={layout}
              onLayoutChange={setLayout}
              repoFilter={filter.isActive ? filter.derivedSelected : undefined}
              onClearFilter={filter.clearAll}
              aliases={aliases.aliases}
              loading={status === 'loading'}
              error={status === 'error' ? error : null}
              onRetry={reload}
            />
            {editing ? (
              <CustomizePanel
                layout={layout}
                onLayoutChange={setLayout}
                onReset={reset}
                aliases={aliases.aliases}
                onSetAlias={aliases.setAlias}
                onClearAlias={aliases.clearAlias}
                onClose={handleCloseCustomize}
              />
            ) : null}
          </>
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
    </FleetUiStateProvider>
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
  { value: 'matrix', label: 'Matrix' },
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
