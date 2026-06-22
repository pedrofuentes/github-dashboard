/**
 * Presentational repo-scope filter (Phase 3, B2). A compact "Filter
 * repositories" disclosure button reveals a labelled `role="group"` of
 * checkboxes — one per fleet repo, each with an accessible name equal to its
 * `nameWithOwner`. When a narrowing filter is active it also renders a scope
 * chip ("Filtered: octo/a (+N)") with an accessible "Clear filter" button.
 *
 * Fully CONTROLLED: the parent owns `useRepoFilter` and passes `selected`,
 * `onToggleRepo`, `onClear` and `isActive` as props; this component holds only
 * the local open/closed disclosure state. Selection changes are announced via a
 * polite live region. Available in display mode (no editing gate). Colours use
 * semantic tokens and the expand affordance honours `prefers-reduced-motion`.
 */
import { useId, useState } from 'react';
import type { ReactElement } from 'react';

import type { Repo } from '../types/fleet';

interface RepoScopeFilterProps {
  /** All fleet repositories to offer in the multi-select. */
  repos: Repo[];
  /** Currently selected repos (empty ⇒ all shown), from `useRepoFilter`. */
  selected: Set<string>;
  /** Adds or removes one repo from the selection. */
  onToggleRepo: (repo: string) => void;
  /** Clears the selection (back to "all shown"). */
  onClear: () => void;
  /** True when a narrowing filter is currently in effect. */
  isActive: boolean;
}

const DISCLOSURE_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function RepoScopeFilter({
  repos,
  selected,
  onToggleRepo,
  onClear,
  isActive,
}: RepoScopeFilterProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const listId = useId();

  const selectedNames = repos
    .map((repo) => repo.nameWithOwner)
    .filter((name) => selected.has(name));
  const primaryName = selectedNames[0];
  const overflowCount = selectedNames.length - 1;

  const announce = (size: number): void => {
    setAnnouncement(
      size === 0
        ? 'Filter cleared'
        : `Filtered to ${size} ${size === 1 ? 'repository' : 'repositories'}`,
    );
  };

  const handleToggle = (name: string): void => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    announce(next.size);
    onToggleRepo(name);
  };

  const handleClear = (): void => {
    announce(0);
    onClear();
  };

  return (
    <div className="relative inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setExpanded((open) => !open)}
        className={DISCLOSURE_BUTTON}
      >
        <span>Filter repositories</span>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform motion-reduce:transition-none ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div
        id={listId}
        role="group"
        aria-label="Filter repositories"
        hidden={!expanded}
        className="absolute left-0 top-full z-10 mt-1 flex max-h-64 min-w-56 flex-col gap-1 overflow-auto rounded-md border border-border-strong bg-surface p-2 shadow-md transition motion-reduce:transition-none"
      >
        {expanded &&
          repos.map((repo) => {
            const name = repo.nameWithOwner;
            return (
              <label
                key={name}
                className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm text-text hover:bg-surface-raised ${FOCUS_RING}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => handleToggle(name)}
                  className={`h-4 w-4 accent-text ${FOCUS_RING}`}
                />
                {name}
              </label>
            );
          })}
      </div>

      {isActive && primaryName && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-raised px-2.5 py-1 text-sm text-text">
          <span>
            Filtered: {primaryName}
            {overflowCount > 0 ? ` (+${overflowCount})` : ''}
          </span>
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear filter"
            className={`rounded p-0.5 text-text-muted hover:text-text ${FOCUS_RING}`}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </span>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
