import { useState } from 'react';
import type { ReactElement } from 'react';

const DISMISSED_KEY = 'gh-dashboard:security-access-dismissed';
const LEARN_MORE_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens';

interface SecurityAccessNoticeProps {
  show: boolean;
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // Dismiss for this render tree even if browser storage is unavailable.
  }
}

export function SecurityAccessNotice({ show }: SecurityAccessNoticeProps): ReactElement | null {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!show || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-border-strong bg-surface-raised px-4 py-3 text-sm text-text shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold text-text">Security grades are unavailable</p>
          <p className="text-text-muted">
            Your token may lack security-alert access, or Dependabot/Code-scanning may be disabled
            on these repos. For a classic PAT, add the{' '}
            <code className="font-mono text-text">security_events</code> scope; for a fine-grained
            PAT, grant <em>Dependabot alerts: read</em> + <em>Code scanning alerts: read</em>, then
            reconnect.
          </p>
          <a
            href={LEARN_MORE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit rounded font-medium text-text underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Learn more
          </a>
        </div>
        <button
          type="button"
          onClick={() => {
            persistDismissed();
            setDismissed(true);
          }}
          className="w-fit rounded border border-border-strong px-3 py-1 text-sm font-medium text-text hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
