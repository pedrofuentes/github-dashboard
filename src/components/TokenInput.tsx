import { useId, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { useAuth } from '../hooks/useAuth';
import type { PersistenceMode } from '../types/auth';

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

/** The seven read-only fine-grained PAT permissions to grant (ADR-003 / research-api §3). */
const READ_ONLY_PERMISSIONS = [
  'Actions',
  'Code scanning alerts',
  'Contents',
  'Dependabot alerts',
  'Issues',
  'Metadata',
  'Pull requests',
];

const PAT_CREATE_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * Accessible entry form for a fine-grained, read-only Personal Access Token.
 *
 * The field is always masked (`type="password"`); the token is never displayed
 * or logged. Persistence defaults to in-memory ("Don't remember") per the
 * privacy-first default in DECISION #3.
 */
export function TokenInput(): ReactElement {
  const { status, error, signIn } = useAuth();
  const [token, setTokenValue] = useState('');
  const [mode, setMode] = useState<PersistenceMode>('none');
  const [localError, setLocalError] = useState<string | null>(null);

  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  const isAuthenticating = status === 'authenticating';
  const message = localError ?? (status === 'error' ? error : null);

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
      <form
        onSubmit={(event) => void handleSubmit(event)}
        aria-busy={isAuthenticating}
        noValidate
        className="space-y-4"
      >
        <div>
          <label htmlFor={inputId} className="sr-only">
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

        <p id={errorId} role="alert" className="min-h-[1.25rem] text-sm text-accent-failure">
          {message}
        </p>
      </form>

      <div id={helpId} className="mt-6 text-sm text-text-muted">
        <p>
          Paste a{' '}
          <a
            href={PAT_CREATE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded font-medium text-text underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            fine-grained personal access token
          </a>{' '}
          granting these <strong>read-only</strong> repository permissions:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {READ_ONLY_PERMISSIONS.map((permission) => (
            <li key={permission}>
              {permission} <span className="text-text-muted">(read-only)</span>
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Those two alert permissions unlock the Security grade; classic PAT users need{' '}
          <code className="font-mono text-text">security_events</code>, otherwise Security shows
          n/a.
        </p>
      </div>
    </div>
  );
}
