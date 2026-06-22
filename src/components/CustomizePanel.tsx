/**
 * CustomizePanel — an accessible modal dialog for tailoring the dashboard: per
 * repository it shows a fieldset of tile-visibility checkboxes, a group
 * hide/show toggle, and an inline display-alias input, plus a reset action.
 *
 * It is a *controlled, presentational* component: the parent owns every hook
 * (layout + alias state) and passes values and callbacks as props, so the panel
 * itself holds no persistence logic and is trivially testable. Visibility flips
 * are computed with the pure {@link flipTileVisibility} / {@link flipRepoVisibility}
 * helpers (never mutating `layout`). Accessibility mirrors {@link DrillDownDrawer}:
 * `role="dialog"` / `aria-modal`, an `aria-labelledby` title, focus moves inside
 * on open, Tab is trapped, `Esc` or a backdrop click closes, and focus returns to
 * the opener on unmount.
 */
import { useEffect, useId, useRef } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';

import { ALIAS_MAX_LENGTH } from '../lib/alias-preference';
import { MAX_TILES } from '../lib/dashboard-layout';
import { SIGNAL_LABELS } from '../lib/grid-keyboard';
import {
  flipRepoVisibility,
  flipTileVisibility,
  groupTilesByRepo,
  isAllHidden,
} from '../lib/tile-visibility';
import type { DashboardTile } from '../types/dashboard';

interface CustomizePanelProps {
  /** The current dashboard layout (hidden tiles included). */
  layout: DashboardTile[];
  /** Emits the next layout after a visibility flip — wires to `useDashboardLayout.setLayout`. */
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
// checkboxes and alias inputs participate in the Tab focus cycle.
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

  const groups = groupTilesByRepo(layout);
  // Flips never grow the array so show/hide can't exceed the cap; the guard
  // exists for any future "add tile" path and feeds the status region (AC-5).
  const atCapacity = layout.length >= MAX_TILES;

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
              Show or hide tiles per repository and set short display aliases.
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

        <div className="mt-4 flex flex-col gap-6">
          {Array.from(groups, ([repo, tiles]) => {
            const groupHidden = isAllHidden(tiles);
            const aliasInputId = `${titleId}-alias-${repo}`;
            return (
              <fieldset key={repo} className="border-t border-border pt-4">
                <legend className="break-words px-1 text-sm font-semibold text-text">{repo}</legend>

                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-xs text-text-muted">
                    {`${tiles.length} ${tiles.length === 1 ? 'tile' : 'tiles'}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onLayoutChange(flipRepoVisibility(layout, repo, groupHidden))}
                    className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-accent-info hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {groupHidden ? `Show all ${repo}` : `Hide all ${repo}`}
                  </button>
                </div>

                <div className="mt-2 flex flex-col gap-2">
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

                <div className="mt-3 flex flex-col gap-1">
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
              </fieldset>
            );
          })}
        </div>

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
