import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

export interface UpdateAvailableToastProps {
  updateAvailable: boolean;
  deployedSha: string | null;
  onReload?: () => void;
}

const DISMISSED_KEY = 'gh-dashboard:update-dismissed';

function readDismissedSha(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function persistDismissedSha(sha: string): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, sha);
  } catch {
    // Storage can be unavailable in private modes; dismissal still works in memory.
  }
}

export function UpdateAvailableToast({
  updateAvailable,
  deployedSha,
  onReload = () => location.reload(),
}: UpdateAvailableToastProps): ReactElement | null {
  const [dismissedSha, setDismissedSha] = useState<string | null>(readDismissedSha);

  useEffect(() => {
    setDismissedSha(readDismissedSha());
  }, [deployedSha]);

  if (!updateAvailable || (deployedSha !== null && dismissedSha === deployedSha)) {
    return null;
  }

  const handleDismiss = (): void => {
    if (deployedSha !== null) {
      persistDismissedSha(deployedSha);
      setDismissedSha(deployedSha);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface-raised px-6 py-4 text-sm text-text shadow-lg"
    >
      <div>
        <p className="font-semibold">A new version is available.</p>
        {deployedSha ? <p className="mt-1 text-text-muted">Deployed build {deployedSha}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReload}
          className="rounded-md bg-accent-info px-3 py-1.5 font-medium text-bg hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 font-medium text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
