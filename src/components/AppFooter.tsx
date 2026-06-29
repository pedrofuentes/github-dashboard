import type { ReactElement } from 'react';

import { buildInfo, formatBuiltAt } from '../lib/build-info';

export function AppFooter(): ReactElement {
  const builtAt = formatBuiltAt(buildInfo.builtAt);

  return (
    <footer className="mx-auto max-w-5xl px-6 pb-6 text-xs text-text-muted">
      {builtAt ? (
        <>
          <span>{builtAt}</span>
          <span aria-hidden="true"> · </span>
        </>
      ) : null}
      {buildInfo.sha === 'dev' ? (
        <span>{buildInfo.sha}</span>
      ) : (
        <a
          href={`https://github.com/pedrofuentes/github-dashboard/commit/${buildInfo.sha}`}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-border-strong underline-offset-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {buildInfo.sha}
        </a>
      )}
    </footer>
  );
}
