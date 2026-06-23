import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { CustomizePanel } from './components/CustomizePanel';
import { DashboardView } from './components/DashboardView';
import { DrillDownDrawer } from './components/DrillDownDrawer';
import { FacetedRepoFilter } from './components/FacetedRepoFilter';
import { FleetGrid } from './components/FleetGrid';
import { FleetMatrix } from './components/FleetMatrix';
import { InboxView } from './components/inbox/InboxView';
import { SettingsOverlay } from './components/SettingsOverlay';
import { TokenInput } from './components/TokenInput';
import { TriageView } from './components/TriageView';
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

  // Lifted here so the single header Settings overlay (Defaults section) and the
  // authenticated FleetPanel (ViewToggle + rendered surface) share ONE source of
  // truth for the live and persisted views. Changing the default also switches
  // the live view, preserving the prior DefaultViewToggle behaviour.
  const [view, setView] = useState<FleetView>(loadDefaultView);
  const [defaultView, setDefaultView] = useState<FleetView>(loadDefaultView);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleViewChange = useCallback((next: FleetView) => setView(next), []);
  const handleDefaultViewChange = useCallback((next: FleetView) => {
    saveDefaultView(next);
    setDefaultView(next);
    setView(next);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Shell never unmounts across auth transitions, so its lazy `view` initializer
  // runs only once. Mirror the pre-refactor FleetPanel remount: whenever the app
  // returns to unauthenticated, reset the live view to the persisted default so a
  // fresh in-session sign-in always opens to the configured default (not the
  // previously-selected live view). `defaultView` stays in sync via
  // handleDefaultViewChange.
  useEffect(() => {
    if (!authenticated) {
      setView(loadDefaultView());
    }
  }, [authenticated]);

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
            <button
              type="button"
              onClick={openSettings}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <GearIcon />
              <span>Settings</span>
            </button>
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
        {authenticated ? (
          <FleetPanel token={token} view={view} onViewChange={handleViewChange} />
        ) : (
          <TokenInput />
        )}
      </main>
      {settingsOpen ? (
        <SettingsOverlay
          defaultView={defaultView}
          onDefaultViewChange={handleDefaultViewChange}
          user={authenticated ? user : null}
          onForget={forget}
          onClose={closeSettings}
        />
      ) : null}
    </div>
  );
}

const GEAR_ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function GearIcon(): ReactElement {
  return (
    <svg {...GEAR_ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
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

interface FleetPanelProps {
  token: string | null;
  /** The live view, owned by {@link Shell} so the Settings overlay can drive it. */
  view: FleetView;
  /** Switches the live view (e.g. from the in-panel ViewToggle). */
  onViewChange: (view: FleetView) => void;
}

function FleetPanel({ token, view, onViewChange }: FleetPanelProps): ReactElement {
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
  const [editing, setEditing] = useState(false);

  // Edit affordances only make sense on the dashboard; leaving it (whether via
  // the in-panel ViewToggle or the Settings overlay's default-view change, both
  // of which flow through the lifted `view`) drops edit mode.
  useEffect(() => {
    if (view !== 'dashboard') {
      setEditing(false);
    }
  }, [view]);

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

  // The matrix, the triage home and the dashboard all honour the active faceted
  // filter. When the filter narrows the fleet, these surfaces render ONLY the
  // matching repos; with no active filter they show the whole fleet. Memoised so
  // the worst-first models only recompute when the fleet or selection changes.
  const filteredRepos = useMemo(
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
  const handleToggleEditing = useCallback(() => setEditing((current) => !current), []);
  // Closing the CustomizePanel (Esc, backdrop, ✕) leaves edit mode, which also
  // unmounts the panel via the `editing` coupling and returns focus to the opener.
  const handleCloseCustomize = useCallback(() => setEditing(false), []);

  return (
    <FleetUiStateProvider>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={onViewChange} unreadCount={inbox.unreadCount} />
          {view === 'dashboard' ? (
            <>
              <FacetedRepoFilter repos={repos} filter={filter} />
              <CustomizeLayoutToggle editing={editing} onToggle={handleToggleEditing} />
            </>
          ) : view === 'matrix' || view === 'triage' ? (
            <FacetedRepoFilter repos={repos} filter={filter} />
          ) : null}
        </div>
        {view === 'triage' ? (
          <TriageView
            repos={filteredRepos}
            getRowData={getRowData}
            onRepoActivate={handleRepoActivate}
            loading={status === 'loading'}
            error={status === 'error' ? error : null}
            onRetry={reload}
          />
        ) : view === 'matrix' ? (
          <FleetMatrix
            repos={filteredRepos}
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
  { value: 'triage', label: 'Triage' },
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
