import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { DashboardView } from './components/DashboardView';
import { DrillDownDrawer } from './components/DrillDownDrawer';
import { FleetGrid } from './components/FleetGrid';
import { TokenInput } from './components/TokenInput';
import { AuthProvider } from './hooks/AuthProvider';
import { useAuth } from './hooks/useAuth';
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:text-slate-900 focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-sky-600"
      >
        Skip to main content
      </a>
      <header className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">github-dashboard</h1>
            <p className="mt-2 text-slate-600">
              Fleet health for your GitHub repositories, at a glance.
            </p>
          </div>
          {authenticated ? <AccountBar user={user} onForget={forget} /> : null}
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
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [view, setView] = useState<FleetView>(loadViewPreference);
  const [editing, setEditing] = useState(false);

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
        <ViewToggle view={view} onChange={handleViewChange} />
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
          ? 'rounded-md border border-sky-700 bg-sky-700 px-3 py-1 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700'
          : 'rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700'
      }
    >
      {editing ? 'Done customizing' : 'Customize layout'}
    </button>
  );
}

interface ViewToggleProps {
  view: FleetView;
  onChange: (view: FleetView) => void;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: FleetView; label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'dashboard', label: 'Dashboard' },
];

function ViewToggle({ view, onChange }: ViewToggleProps): ReactElement {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex w-fit rounded-md border border-slate-300 bg-white p-0.5"
    >
      {VIEW_OPTIONS.map((option) => {
        const isActive = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={
              isActive
                ? 'rounded px-3 py-1 text-sm font-medium bg-slate-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600'
                : 'rounded px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600'
            }
          >
            {option.label}
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
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600"
        >
          {user.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <p className="text-sm text-slate-700">{`Authenticated as ${user.login}`}</p>
      <button
        type="button"
        onClick={onForget}
        className="rounded border border-slate-300 px-3 py-1 text-sm font-medium hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        Forget token
      </button>
    </div>
  );
}
