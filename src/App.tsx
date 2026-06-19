import type { ReactElement } from 'react';

import { TokenInput } from './components/TokenInput';
import { AuthProvider } from './hooks/AuthProvider';
import { useAuth } from './hooks/useAuth';
import type { AuthUser } from './types/auth';

export function App(): ReactElement {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell(): ReactElement {
  const { status, user, forget } = useAuth();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">github-dashboard</h1>
        <p className="mt-2 text-slate-600">
          Fleet health for your GitHub repositories, at a glance.
        </p>
      </header>
      <section aria-labelledby="overview-heading" className="mx-auto max-w-5xl px-6 pb-12">
        <h2 id="overview-heading" className="sr-only">
          Fleet overview
        </h2>
        {status === 'authenticated' && user !== null ? (
          <AuthenticatedPanel user={user} onForget={forget} />
        ) : (
          <TokenInput />
        )}
      </section>
    </main>
  );
}

interface AuthenticatedPanelProps {
  user: AuthUser;
  onForget: () => void;
}

function AuthenticatedPanel({ user, onForget }: AuthenticatedPanelProps): ReactElement {
  return (
    <div className="flex items-center gap-4">
      <img src={user.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full" />
      <p className="text-slate-700">{`Authenticated as ${user.login}`}</p>
      <button
        type="button"
        onClick={onForget}
        className="rounded border border-slate-300 px-3 py-1 text-sm font-medium"
      >
        Forget token
      </button>
    </div>
  );
}
