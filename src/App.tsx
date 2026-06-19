import type { ReactElement } from 'react';

export function App(): ReactElement {
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
        <p className="text-slate-500">No repositories configured yet.</p>
      </section>
    </main>
  );
}
