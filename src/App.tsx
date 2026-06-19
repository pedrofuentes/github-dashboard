import { useState } from 'react';
import type { ReactElement } from 'react';

import { DrillDownDrawer } from './components/DrillDownDrawer';
import { FleetGrid } from './components/FleetGrid';
import { TokenInput } from './components/TokenInput';
import { AuthProvider } from './hooks/AuthProvider';
import { useAuth } from './hooks/useAuth';
import { useRepoSignals } from './hooks/useRepoSignals';
import { useRepos } from './hooks/useRepos';
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

  return (
    <>
      <FleetGrid
        repos={repos}
        getRowData={getRowData}
        loading={status === 'loading'}
        error={status === 'error' ? error : null}
        onRetry={reload}
        onRepoActivate={(repo) => setSelectedRepo(repo)}
      />
      {selectedRepo !== null ? (
        <DrillDownDrawer
          repo={selectedRepo}
          data={getRowData(selectedRepo)}
          onClose={() => setSelectedRepo(null)}
        />
      ) : null}
    </>
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
