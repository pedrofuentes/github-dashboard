/**
 * DeckCustomizePanel — an accessible modal dialog for tailoring which keys the
 * Deck ({@link BoardView}) shows, using the same RULE-BASED controls as
 * {@link CustomizePanel} but for the Deck's visibility-only, `Set`-based model
 * (no display aliases): global per-signal toggles (show/hide a signal across
 * ALL repos), bulk Show all / Hide all / Show only…, and — for targeted work —
 * a repo search surfacing per-repo row toggles and per-(repo, signal) overrides,
 * plus a reset.
 *
 * It is a *controlled, presentational* component: the parent owns the hidden
 * `Set<string>` (and its persistence) and passes granular callbacks, so the
 * panel itself holds no state beyond local UI (the "Show only…" selection and
 * the repo-search query). Tri-state counts come from the pure transforms in
 * {@link deck-visibility} ({@link signalVisibilitySummary} /
 * {@link repoVisibilitySummary} / {@link isHidden}). Accessibility: a labelled
 * `role="dialog"` non-modal drawer (the deck stays interactive beside it — no
 * backdrop, no focus trap), `Esc` or the close control closes it, and focus
 * moves inside on open and returns to the opener on unmount.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import {
  DECK_SIGNALS,
  isHidden,
  repoVisibilitySummary,
  signalVisibilitySummary,
} from '../../lib/deck-visibility';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import type { TileSignalType } from '../../types/dashboard';
import type { Repo } from '../../types/fleet';
import { DeckSignalOrderList } from './DeckSignalOrderList';

export interface DeckCustomizePanelProps {
  /** The repositories whose keys the Deck renders (already adapted by `useRepos`). */
  repos: Repo[];
  /** The hidden-keys set (`repo:signal` ids); empty ⇒ everything is shown. */
  hidden: Set<string>;
  /** Flips one (repo, signal) key's visibility. */
  onToggleKey: (repo: string, signal: TileSignalType) => void;
  /** Shows (`hide=false`) or hides (`hide=true`) one signal across ALL repos. */
  onSetSignal: (signal: TileSignalType, hide: boolean) => void;
  /** Shows or hides every signal for one repo (the per-repo row toggle). */
  onSetRepo: (repo: string, hide: boolean) => void;
  /** Bulk Show all (`false`) / Hide all (`true`) across the whole Deck. */
  onSetAll: (hide: boolean) => void;
  /** Keeps only the `keep` signals visible, hiding every other signal. */
  onShowOnly: (keep: Set<TileSignalType>) => void;
  /** Restores the default (all-visible) Deck. */
  onReset: () => void;
  /** Restores the default repo-row and signal-column order. */
  onResetOrder: () => void;
  /** Signal columns in their current order (drives the reorder list). */
  signalOrder: readonly TileSignalType[];
  /** Reorders the signal column at `from` to `to` (drawer drag list). */
  onMoveSignal: (from: number, to: number) => void;
  /** Closes the panel and returns focus to the opener. */
  onClose: () => void;
}

// Classifies a `{ shown, total }` tally as the tri-state the UI renders.
function visibilityState(shown: number, total: number): 'all' | 'some' | 'none' {
  if (shown === 0) return 'none';
  return shown === total ? 'all' : 'some';
}

export function DeckCustomizePanel({
  repos,
  hidden,
  onToggleKey,
  onSetSignal,
  onSetRepo,
  onSetAll,
  onShowOnly,
  onReset,
  onResetOrder,
  signalOrder,
  onMoveSignal,
  onClose,
}: DeckCustomizePanelProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Local-only UI state: which signals are checked for the "Show only…" action,
  // and the repo-search query that narrows the per-repo override list.
  const [onlySelection, setOnlySelection] = useState<Set<TileSignalType>>(new Set());
  const [repoQuery, setRepoQuery] = useState('');

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  function toggleOnlySelection(signal: TileSignalType) {
    setOnlySelection((current) => {
      const next = new Set(current);
      if (next.has(signal)) next.delete(signal);
      else next.add(signal);
      return next;
    });
  }

  // Global signal rules consider EVERY repo (the toggle spans the whole Deck).
  const repoNames = useMemo(() => repos.map((repo) => repo.nameWithOwner), [repos]);
  const signalSummaries = useMemo(
    () => signalVisibilitySummary(hidden, repoNames, DECK_SIGNALS),
    [hidden, repoNames],
  );

  // Per-repo overrides use search-to-reveal: an empty query shows no repos; a
  // query filters to matches, and the summary drives each row's tri-state —
  // `repoVisibilitySummary` preserves order, so it aligns with `matchingRepos`.
  const matchingRepos = useMemo(() => {
    const query = repoQuery.trim().toLowerCase();
    if (query === '') return [];
    return repos.filter((repo) => repo.nameWithOwner.toLowerCase().includes(query));
  }, [repos, repoQuery]);
  const repoSummaries = useMemo(
    () =>
      repoVisibilitySummary(
        hidden,
        matchingRepos.map((repo) => repo.nameWithOwner),
        DECK_SIGNALS,
      ),
    [hidden, matchingRepos],
  );

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface p-6 text-text shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">
              Customize deck
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Show or hide keys by signal across every repo, or fine-tune one repo at a time.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close customize panel"
            className="shrink-0 rounded p-1 text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSetAll(false)}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Show all keys
          </button>
          <button
            type="button"
            onClick={() => onSetAll(true)}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Hide all keys
          </button>
        </div>

        <fieldset className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <legend className="px-1 text-sm font-semibold text-text">Signal order</legend>
          <p className="px-1 text-xs text-text-muted">
            Drag to reorder the signal columns across every repository.
          </p>
          <div className="px-1">
            <DeckSignalOrderList signalOrder={signalOrder} onMoveSignal={onMoveSignal} />
          </div>
        </fieldset>

        <fieldset className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <legend className="px-1 text-sm font-semibold text-text">Signal rules</legend>
          <p className="px-1 text-xs text-text-muted">Each toggle applies to every repository.</p>
          {signalSummaries.map(({ signal, shown, total }) => {
            const state = visibilityState(shown, total);
            const allShown = state === 'all';
            const label = SIGNAL_LABELS[signal];
            return (
              <div key={signal} data-signal={signal} className="flex items-center gap-3 px-1">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={onlySelection.has(signal)}
                    onChange={() => toggleOnlySelection(signal)}
                    aria-label={`Include ${label} in show-only selection`}
                    className="h-4 w-4 rounded border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  />
                  <span className="font-medium">{label}</span>
                </label>
                <span className="ml-auto text-xs text-text-muted" data-state={state}>
                  {`${shown} of ${total} shown`}
                </span>
                <button
                  type="button"
                  onClick={() => onSetSignal(signal, allShown)}
                  aria-label={`${allShown ? 'Hide' : 'Show'} all ${label} keys`}
                  className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-accent-info hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {allShown ? `Hide all ${label}` : `Show all ${label}`}
                </button>
              </div>
            );
          })}
          <button
            type="button"
            disabled={onlySelection.size === 0}
            onClick={() => onShowOnly(onlySelection)}
            className="mt-2 self-start rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            Show only selected
          </button>
        </fieldset>

        <fieldset className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
          <legend className="px-1 text-sm font-semibold text-text">Per-repository keys</legend>
          <div className="flex flex-col gap-1 px-1">
            <label
              htmlFor={`${titleId}-repo-search`}
              className="text-xs font-medium text-text-muted"
            >
              Search repositories
            </label>
            <input
              id={`${titleId}-repo-search`}
              type="text"
              value={repoQuery}
              onChange={(event) => setRepoQuery(event.target.value)}
              placeholder="owner/name"
              aria-describedby={`${titleId}-repo-search-hint`}
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <p id={`${titleId}-repo-search-hint`} className="text-xs text-text-muted">
              Search a repository to reveal and override its keys.
            </p>
          </div>

          {repoSummaries.map(({ repo, shown, total }) => {
            const state = visibilityState(shown, total);
            const allShown = state === 'all';
            return (
              <div key={repo} data-repo={repo} className="flex flex-col gap-2 px-1">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 break-words text-sm font-semibold text-text">{repo}</p>
                  <span className="ml-auto text-xs text-text-muted" data-state={state}>
                    {`${shown} of ${total} shown`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSetRepo(repo, allShown)}
                    aria-label={`${allShown ? 'Hide' : 'Show'} all keys for ${repo}`}
                    className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-accent-info hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {allShown ? 'Hide all' : 'Show all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {DECK_SIGNALS.map((signal) => {
                    const keyHidden = isHidden(hidden, repo, signal);
                    const label = SIGNAL_LABELS[signal];
                    return (
                      <label key={signal} className="flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          checked={!keyHidden}
                          onChange={() => onToggleKey(repo, signal)}
                          aria-label={`${repo}, ${label} key, ${keyHidden ? 'hidden' : 'shown'}`}
                          className="h-4 w-4 rounded border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        />
                        <span aria-hidden="true">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </fieldset>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onResetOrder}
            className="rounded border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Reset order
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded bg-text px-4 py-2 text-sm font-medium text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Reset to default
          </button>
        </div>
      </div>
    </div>
  );
}
