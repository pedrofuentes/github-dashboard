import { useId, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { useAuth } from '../hooks/useAuth';
import type { PersistenceMode } from '../types/auth';
import { GitHubStatusHint } from './GitHubStatusHint';

interface PersistenceOption {
  value: PersistenceMode;
  label: string;
  hint: string;
}

const PERSISTENCE_OPTIONS: PersistenceOption[] = [
  {
    value: 'none',
    label: "Don't remember",
    hint: 'Keep the token in memory only; it is cleared when you leave this page.',
  },
  {
    value: 'session',
    label: 'This session',
    hint: 'Remember until this browser tab is closed (sessionStorage).',
  },
  {
    value: 'local',
    label: 'This device',
    hint: 'Remember on this device until you forget it (localStorage).',
  },
];

/**
 * The seven read-only fine-grained PAT permissions to grant (ADR-003 / research-api §3).
 *
 * `slug` is GitHub's URL-parameter key for each permission — used to pre-select it on the
 * token-creation page (see `buildPatCreateUrl`). Two slugs deliberately differ from their
 * display label because GitHub's form still uses the older REST property names: "Code
 * scanning alerts" is `security_events` and "Dependabot alerts" is `vulnerability_alerts`.
 * The label-based slugs (`code_scanning_alerts` / `dependabot_alerts`) are silently ignored.
 */
const READ_ONLY_PERMISSIONS = [
  { label: 'Actions', slug: 'actions' },
  { label: 'Code scanning alerts', slug: 'security_events' },
  { label: 'Contents', slug: 'contents' },
  { label: 'Dependabot alerts', slug: 'vulnerability_alerts' },
  { label: 'Issues', slug: 'issues' },
  { label: 'Metadata', slug: 'metadata' },
  { label: 'Pull requests', slug: 'pull_requests' },
] as const;

/**
 * Deep-links to GitHub's fine-grained PAT page with the required permissions, a recognizable
 * name/description, and a 90-day expiry pre-filled via URL parameters, so the user only has
 * to pick a resource owner + repositories and click "Generate token". `target_name` (owner)
 * is intentionally omitted — it pre-fills visually but doesn't bind the token to that owner.
 */
function buildPatCreateUrl(): string {
  const params = new URLSearchParams({
    name: 'GitHub Dashboard (read-only)',
    description: 'Read-only access for the GitHub Dashboard fleet view.',
    expires_in: '90',
  });
  for (const { slug } of READ_ONLY_PERMISSIONS) {
    params.set(slug, 'read');
  }
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

const PAT_CREATE_URL = buildPatCreateUrl();

/**
 * Accessible entry form for a fine-grained, read-only Personal Access Token.
 *
 * The field is always masked (`type="password"`); the token is never displayed
 * or logged. Persistence defaults to in-memory ("Don't remember") per the
 * privacy-first default in DECISION #3.
 */
export function TokenInput(): ReactElement {
  const { status, error, errorKind, signIn } = useAuth();
  const [token, setTokenValue] = useState('');
  const [mode, setMode] = useState<PersistenceMode>('none');
  const [localError, setLocalError] = useState<string | null>(null);

  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  const isAuthenticating = status === 'authenticating';
  const message = localError ?? (status === 'error' ? error : null);
  // Only for a real GitHub-side failure (not the local empty-field guard, and
  // not a malformed-response 'other'): an incident can spuriously reject a valid
  // token or make GitHub look unreachable.
  const showStatusHint =
    localError === null &&
    status === 'error' &&
    (errorKind === 'network' || errorKind === 'auth' || errorKind === 'server');

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = token.trim();
    if (trimmed === '') {
      setLocalError('Enter your personal access token to continue.');
      return;
    }
    setLocalError(null);
    await signIn(trimmed, mode);
  }

  return (
    <div className="mx-auto max-w-md">
      <h2 className="text-lg font-semibold text-text">Connect your GitHub account</h2>
      <p className="mt-1 text-sm text-text-muted">
        You&rsquo;ll need a GitHub token so the dashboard can read your repositories. It takes about
        a minute — just follow these steps.
      </p>

      {/* Instructions come BEFORE the form: people skim top-down, so the "how" has
          to be the first thing they see, not a footnote under the input. */}
      <ol
        id={helpId}
        className="mt-5 list-decimal space-y-4 pl-5 text-sm text-text marker:text-text-muted"
      >
        <li>
          <p className="font-medium text-text">Create a fine-grained, read-only token on GitHub.</p>
          <a
            href={PAT_CREATE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex w-fit items-center gap-1 rounded border border-border-strong px-3 py-1.5 font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Create token on GitHub <span aria-hidden="true">↗</span>
          </a>
          <p className="mt-2 text-text-muted">
            The link sets a <strong className="text-text">90-day expiry</strong> — change it if you
            like, but once it lapses you&rsquo;ll need to regenerate the token and reconnect. You
            choose the <strong className="text-text">Resource owner</strong> (your account or an
            org) and which repositories the token can read.
          </p>
        </li>
        <li>
          <p className="font-medium text-text">
            Confirm these <strong>read-only</strong> repository permissions:
          </p>
          <p className="mt-1 text-text-muted">
            We&rsquo;ve pre-selected them for you — just check they show:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-text-muted">
            {READ_ONLY_PERMISSIONS.map(({ label }) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p className="mt-2 text-text-muted">
            Those two alert permissions unlock the Security grade; classic PAT users need{' '}
            <code className="font-mono text-text">security_events</code>, otherwise Security shows
            n/a.
          </p>
        </li>
        <li>
          <p className="font-medium text-text">Paste it below and connect.</p>
        </li>
      </ol>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        aria-busy={isAuthenticating}
        noValidate
        className="mt-6 space-y-4"
      >
        <div>
          <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-text">
            GitHub personal access token
          </label>
          <input
            id={inputId}
            name="github-token"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={token}
            onChange={(event) => {
              setTokenValue(event.target.value);
            }}
            disabled={isAuthenticating}
            aria-describedby={`${helpId} ${errorId}`}
            placeholder="github_pat_…"
            className="w-full rounded border border-border-strong px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
        </div>

        <fieldset disabled={isAuthenticating} className="space-y-2">
          <legend className="text-sm font-medium text-text-muted">Remember this token</legend>
          {PERSISTENCE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="persistence"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-text">{option.label}</span>
                <span className="block text-sm text-text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={isAuthenticating}
          className="rounded bg-text px-4 py-2 font-medium text-surface disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {isAuthenticating ? 'Connecting…' : 'Connect to GitHub'}
        </button>

        <div role="alert" className="text-accent-failure">
          <p id={errorId} className="min-h-[1.25rem] text-sm">
            {message}
          </p>
          {showStatusHint ? <GitHubStatusHint /> : null}
        </div>
      </form>
    </div>
  );
}
