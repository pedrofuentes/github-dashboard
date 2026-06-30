/**
 * CustomizePanel — an accessible modal dialog for tailoring the dashboard with
 * RULE-BASED controls instead of a per-repo checkbox grind: global signal
 * toggles (show/hide a signal across ALL repos), bulk Show all / Hide all /
 * Show only… actions, and — for power users — a repo search that surfaces
 * targeted per-repo signal overrides and display-alias inputs, plus a reset.
 *
 * It is a *controlled, presentational* component: the parent owns every hook
 * (layout + alias state) and passes values and callbacks as props, so the panel
 * itself holds no persistence logic and is trivially testable. Visibility
 * changes are computed with the pure transforms in {@link tile-visibility}
 * (never mutating `layout`). Accessibility mirrors {@link DrillDownDrawer}:
 * `role="dialog"` / `aria-modal`, an `aria-labelledby` title, focus moves inside
 * on open, Tab is trapped, `Esc` or a backdrop click closes, and focus returns to
 * the opener on unmount.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';

import { ALIAS_MAX_LENGTH } from '../lib/alias-preference';
import { MAX_TILES } from '../lib/dashboard-layout';
import { SIGNAL_LABELS } from '../lib/grid-keyboard';
import {
  flipTileVisibility,
  groupTilesByRepo,
  setAllVisibility,
  setSignalVisibility,
  showOnlySignals,
  signalVisibilitySummary,
} from '../lib/tile-visibility';
import type { DashboardTile, TileSignalType } from '../types/dashboard';

interface CustomizePanelProps {
  /** The current dashboard layout (hidden tiles included). */
  layout: DashboardTile[];
  /** Emits the next layout after a visibility change — wires to `useDashboardLayout.setLayout`. */
  onLayoutChange: (next: DashboardTile[]) => void;
  /** Repo → display alias map (parent-owned). */
  aliases: Record<string, string>;
  /** Sets the alias for one repo. */
  onSetAlias: (repo: string, alias: string) => void;
  /** Clears the alias for one repo. */
  onClearAlias: (repo: string) => void;
  /** Restores the default layout — wires to `useDashboardLayout.reset`. */
  onReset: () => void;
  /** Closes the panel and returns focus to the opener. */
  onClose: () => void;
}

// Mirrors DrillDownDrawer's trap selector, extended with form controls so the
// toggles, checkboxes and inputs participate in the Tab focus cycle.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function CustomizePanel({
  layout,
  onLayoutChange,
  aliases,
  onSetAlias,
  onClearAlias,
  onReset,
  onClose,
}: CustomizePanelProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Local-only UI state: which signals are checked for the "Show only…" action,
  // and the repo-search query that surfaces targeted per-repo overrides.
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
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = getFocusableElements(dialogRef.current);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Commit on blur: a non-empty (trimmed) value sets the alias, an empty one
  // clears it. Trimming/clamping is also enforced by the parent's alias module.
  function handleAliasBlur(repo: string, event: FocusEvent<HTMLInputElement>) {
    const trimmed = event.target.value.trim();
    if (trimmed === '') {
      onClearAlias(repo);
    } else {
      onSetAlias(repo, trimmed);
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

  const summary = useMemo(() => signalVisibilitySummary(layout), [layout]);
  // Changes never grow the array so show/hide can't exceed the cap; the guard
  // exists for any future "add tile" path and feeds the status region (AC-5).
  const atCapacity = layout.length >= MAX_TILES;

  // Power-user escape hatch: a repo search keeps targeted per-repo overrides
  // available without re-introducing the ~300-checkbox default grind.
  const allGrouped = useMemo(() => groupTilesByRepo(layout), [layout]);
  const matchingRepos = useMemo(() => {
    const query = repoQuery.trim().toLowerCase();
    if (query === '') return [] as Array<[string, DashboardTile[]]>;
    return Array.from(allGrouped).filter(([repo]) =>
      repo.toLowerCase().includes(query),
    );
  }, [allGrouped, repoQuery]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        data-testid="customize-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface p-6 text-text shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">
              Customize dashboard
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Shape the board with signal rules — show or hide a signal across every repo at once.
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

        <div
          role="status"
          aria-live="polite"
          className="mt-2 min-h-[1.25rem] text-sm text-accent-warning-ink"
        >
          {atCapacity
            ? `Tile limit reached (${MAX_TILES}). Hide a tile before adding another.`
            : ''}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onLayoutChange(setAllVisibility(layout, true))}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Show all tiles
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange(setAllVisibility(layout, false))}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Hide all tiles
          </button>
        </div>

        <fieldset
          aria-label="Signal rules"
          className="mt-6 flex flex-col gap-2 border-t border-border pt-4"
        >
          <legend className="px-1 text-sm font-semibold text-text">Signal rules</legend>
          <p className="px-1 text-xs text-text-muted">
            Each toggle applies to every repository at once.
          </p>
          {summary.map(({ signal, shown, total }) => {
            const allShown = shown === total;
            const state = shown === 0 ? 'none' : allShown ? 'all' : 'some';
            const nextVisible = !allShown;
            const label = SIGNAL_LABELS[signal];
            return (
              <div key={signal} className="flex items-center gap-3 px-1">
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
                  onClick={() => onLayoutChange(setSignalVisibility(layout, signal, nextVisible))}
                  aria-label={`${nextVisible ? 'Show' : 'Hide'} all ${label} tiles`}
                  className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-accent-info hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {nextVisible ? `Show all ${label}` : `Hide all ${label}`}
                </button>
              </div>
            );
          })}
          <button
            type="button"
            disabled={onlySelection.size === 0}
            onClick={() => onLayoutChange(showOnlySignals(layout, onlySelection))}
            className="mt-2 self-start rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            Show only selected
          </button>
        </fieldset>

        <fieldset className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
          <legend className="px-1 text-sm font-semibold text-text">Per-repository overrides</legend>
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
              Search a repository to override individual tiles or set a display alias.
            </p>
          </div>

          {matchingRepos.map(([repo, tiles]) => {
            const aliasInputId = `${titleId}-alias-${repo}`;
            return (
              <div key={repo} className="flex flex-col gap-2 px-1">
                <p className="break-words text-sm font-semibold text-text">{repo}</p>
                <div className="flex flex-col gap-2">
                  {tiles.map((t) => (
                    <label key={t.i} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={t.visible}
                        onChange={() => onLayoutChange(flipTileVisibility(layout, t.i, !t.visible))}
                        aria-label={`${t.repo}, ${SIGNAL_LABELS[t.signal]} tile, ${
                          t.visible ? 'shown' : 'hidden'
                        }`}
                        className="h-4 w-4 rounded border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      />
                      <span aria-hidden="true">{SIGNAL_LABELS[t.signal]}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={aliasInputId} className="text-xs font-medium text-text-muted">
                    {`Alias for ${repo}`}
                  </label>
                  <input
                    id={aliasInputId}
                    type="text"
                    maxLength={ALIAS_MAX_LENGTH}
                    defaultValue={aliases[repo] ?? ''}
                    placeholder={repo}
                    onBlur={(event) => handleAliasBlur(repo, event)}
                    className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  />
                </div>
              </div>
            );
          })}
        </fieldset>

        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            type="button"
            onClick={onReset}
            className="rounded bg-text px-4 py-2 text-sm font-medium text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Reset to default layout
          </button>
        </div>
      </div>
    </div>
  );
}
