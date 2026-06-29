/**
 * SavedViewsMenu — the Saved Views quick-switcher + manager (e2). A labelled
 * disclosure reveals a token-styled panel that lists the user's saved views
 * (apply / rename / delete) and a "save current as view" form capturing the
 * live filter + target view. It is fully CONTROLLED + presentational: the parent
 * owns {@link useSavedViews} (or any equivalent) and passes its result + the
 * current filter/view straight through; this component holds only local
 * open/closed + inline-edit state.
 *
 * Validation lives at this consumer boundary too (the e1 lib's mutation ops are
 * unvalidated — #436): create/rename reject an empty / over-long name BEFORE
 * calling the parent, surfacing inline `role="alert"` feedback rather than
 * silently failing persistence. Accessibility mirrors the repo's disclosure
 * patterns (FacetedRepoFilter / DrillDownDrawer): focus moves into the panel on
 * open, `Esc` closes and returns focus to the button, a click outside closes,
 * actions are announced via a polite live region, every control is a labelled,
 * keyboard-operable button, and the panel honours `prefers-reduced-motion`.
 * Colours use semantic tokens only.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { RepoFilterQueryV2 } from '../lib/repo-filter-query';
import type { FleetView } from '../lib/view-preference';
import type { SavedView } from '../lib/saved-views';
import {
  validateViewName,
  type CreateSavedViewInput,
  type SavedViewMutationResult,
} from '../hooks/useSavedViews';

interface SavedViewsMenuProps {
  /** The user's saved views (typically from {@link useSavedViews}). */
  views: SavedView[];
  /** Read-only built-in starter views, rendered apply-only above the saved set. */
  presets?: SavedView[];
  /** The live repo filter, captured when saving a new view. */
  currentFilter: RepoFilterQueryV2;
  /** The live target view, captured when saving a new view. */
  currentView: FleetView;
  /** Applies a saved view (the parent restores its filter + view). */
  onApply: (view: SavedView) => void;
  /** Persists a new view; returns a validated result for inline feedback. */
  onCreate: (input: CreateSavedViewInput) => SavedViewMutationResult;
  /** Renames a view; returns a validated result for inline feedback. */
  onRename: (id: string, name: string) => SavedViewMutationResult;
  /** Removes a view (confirmed inline before this is called). */
  onRemove: (id: string) => void;
}

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const DISCLOSURE_BUTTON = `inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised ${FOCUS_RING}`;
const PRIMARY_BUTTON = `rounded border border-border-strong bg-surface-raised px-2 py-1 text-xs font-medium text-text hover:bg-surface-hover disabled:opacity-50 ${FOCUS_RING}`;
const GHOST_BUTTON = `rounded px-1.5 py-1 text-xs font-medium text-text-muted hover:bg-surface-raised hover:text-text ${FOCUS_RING}`;
const DANGER_BUTTON = `rounded border border-accent-failure px-2 py-1 text-xs font-medium text-accent-failure hover:bg-surface-raised ${FOCUS_RING}`;
const INPUT = `w-full rounded border border-border-strong bg-surface px-2 py-1 text-sm text-text placeholder:text-text-muted ${FOCUS_RING}`;

/** One saved view row: apply / rename / delete with inline rename + confirm. */
function SavedViewRow({
  view,
  isRenaming,
  isConfirmingDelete,
  onApply,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  renameError,
}: {
  view: SavedView;
  isRenaming: boolean;
  isConfirmingDelete: boolean;
  onApply: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (name: string) => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  renameError: string | null;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState(view.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setDraft(view.name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming, view.name]);

  if (isRenaming) {
    return (
      <li className="flex flex-col gap-1 rounded px-1 py-1">
        <label htmlFor={`${errorId}-input`} className="text-xs font-medium text-text-muted">
          Rename view
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id={`${errorId}-input`}
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmitRename(draft);
              }
            }}
            aria-label="Rename view"
            aria-invalid={renameError !== null}
            aria-describedby={renameError !== null ? errorId : undefined}
            className={INPUT}
          />
          <button type="button" onClick={() => onSubmitRename(draft)} className={PRIMARY_BUTTON}>
            Save name
          </button>
          <button type="button" onClick={onCancelRename} className={GHOST_BUTTON}>
            Cancel
          </button>
        </div>
        {renameError !== null ? (
          <p id={errorId} role="alert" className="text-xs text-accent-failure">
            {renameError}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-surface-raised">
      <button
        type="button"
        onClick={onApply}
        aria-label={`Apply saved view ${view.name}`}
        className={`flex-1 truncate rounded px-1.5 py-1 text-left text-sm text-text hover:bg-surface-hover ${FOCUS_RING}`}
      >
        {view.name}
      </button>
      {isConfirmingDelete ? (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Delete?</span>
          <button type="button" onClick={onConfirmDelete} className={DANGER_BUTTON}>
            Confirm delete
          </button>
          <button type="button" onClick={onCancelDelete} className={GHOST_BUTTON}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onStartRename}
            aria-label={`Rename saved view ${view.name}`}
            className={GHOST_BUTTON}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={onStartDelete}
            aria-label={`Delete saved view ${view.name}`}
            className={GHOST_BUTTON}
          >
            Delete
          </button>
        </span>
      )}
    </li>
  );
}

export function SavedViewsMenu({
  views,
  presets,
  currentFilter,
  currentView,
  onApply,
  onCreate,
  onRename,
  onRemove,
}: SavedViewsMenuProps) {
  const panelId = useId();
  const nameInputId = useId();
  const createErrorId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setRenamingId(null);
    setRenameError(null);
    setConfirmingDeleteId(null);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  // Move focus into the panel when it opens (a11y), so Esc / Tab act on it.
  useEffect(() => {
    if (open) {
      nameInputRef.current?.focus();
    }
  }, [open]);

  // Close on Escape regardless of where focus sits inside the open panel.
  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, close]);

  // Close when a pointer lands outside the button + panel (non-modal popover).
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) === true ||
        buttonRef.current?.contains(target) === true
      ) {
        return;
      }
      close(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, close]);

  function handleSubmitCreate(): void {
    const localError = validateViewName(name);
    if (localError !== null) {
      setCreateError(localError);
      return;
    }
    const result = onCreate({ name: name.trim(), view: currentView, filter: currentFilter });
    if (result.ok) {
      setName('');
      setCreateError(null);
      setAnnouncement(`Saved view ${result.view?.name ?? name.trim()}.`);
    } else {
      setCreateError(result.error ?? 'Could not save this view.');
    }
  }

  function handleSubmitRename(id: string, nextName: string): void {
    const localError = validateViewName(nextName);
    if (localError !== null) {
      setRenameError(localError);
      return;
    }
    const result = onRename(id, nextName.trim());
    if (result.ok) {
      setRenamingId(null);
      setRenameError(null);
      setAnnouncement(`Renamed view to ${nextName.trim()}.`);
    } else {
      setRenameError(result.error ?? 'Could not rename this view.');
    }
  }

  function handleApply(view: SavedView): void {
    onApply(view);
    setAnnouncement(`Applied view ${view.name}.`);
    close(false);
  }

  function handleConfirmDelete(view: SavedView): void {
    onRemove(view.id);
    setConfirmingDeleteId(null);
    setAnnouncement(`Deleted view ${view.name}.`);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => (open ? close(false) : setOpen(true))}
        className={DISCLOSURE_BUTTON}
      >
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
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        <span>Saved views</span>
        {views.length > 0 ? (
          <span className="rounded-full bg-surface-raised px-1.5 text-xs tabular-nums text-text-muted">
            {views.length}
          </span>
        ) : null}
      </button>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label="Saved views"
          onKeyDown={handlePanelKeyDown}
          className="absolute left-0 top-full z-20 mt-1 flex w-80 flex-col gap-3 rounded-md border border-border-strong bg-surface-overlay p-3 shadow-lg transition motion-reduce:transition-none"
        >
          {presets !== undefined && presets.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Presets
              </p>
              <ul
                aria-label="View presets"
                className="flex max-h-48 flex-col gap-0.5 overflow-auto"
              >
                {presets.map((preset) => (
                  <li key={preset.id} className="rounded px-1 py-1 hover:bg-surface-raised">
                    <button
                      type="button"
                      onClick={() => handleApply(preset)}
                      aria-label={`Apply preset ${preset.name}`}
                      className={`w-full truncate rounded px-1.5 py-1 text-left text-sm text-text hover:bg-surface-hover ${FOCUS_RING}`}
                    >
                      {preset.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Saved views
            </p>
            {views.length === 0 ? (
              <p className="px-1 text-sm text-text-muted">
                No saved views yet — save your current filter to get started.
              </p>
            ) : (
              <ul aria-label="Saved views" className="flex max-h-72 flex-col gap-0.5 overflow-auto">
                {views.map((view) => (
                  <SavedViewRow
                    key={view.id}
                    view={view}
                    isRenaming={renamingId === view.id}
                    isConfirmingDelete={confirmingDeleteId === view.id}
                    renameError={renamingId === view.id ? renameError : null}
                    onApply={() => handleApply(view)}
                    onStartRename={() => {
                      setRenamingId(view.id);
                      setRenameError(null);
                      setConfirmingDeleteId(null);
                    }}
                    onCancelRename={() => {
                      setRenamingId(null);
                      setRenameError(null);
                    }}
                    onSubmitRename={(nextName) => handleSubmitRename(view.id, nextName)}
                    onStartDelete={() => {
                      setConfirmingDeleteId(view.id);
                      setRenamingId(null);
                    }}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                    onConfirmDelete={() => handleConfirmDelete(view)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <label htmlFor={nameInputId} className="text-xs font-medium text-text-muted">
              Name this view
            </label>
            <input
              id={nameInputId}
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (createError !== null) {
                  setCreateError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSubmitCreate();
                }
              }}
              placeholder="e.g. Broken CI"
              aria-invalid={createError !== null}
              aria-describedby={createError !== null ? createErrorId : undefined}
              className={INPUT}
            />
            <button type="button" onClick={handleSubmitCreate} className={PRIMARY_BUTTON}>
              Save current as view
            </button>
            {createError !== null ? (
              <p id={createErrorId} role="alert" className="text-xs text-accent-failure">
                {createError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
