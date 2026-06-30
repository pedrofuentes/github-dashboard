/**
 * CommandPalette — the reusable, accessible ⌘K command surface (the "shell").
 *
 * It is a fully CONTROLLED, presentational modal: the parent owns visibility
 * (`open` / `onClose`, e.g. from {@link useCommandPalette}) and supplies the list
 * of {@link CommandItem}s plus an optional list of recent command ids. The parent
 * wires the real command registry (e.g. {@link App} builds commands from
 * navigation, filters, and settings). This component renders + drives the palette.
 *
 * Accessibility mirrors the repo's dialog + combobox/listbox patterns
 * (DrillDownDrawer, FacetedRepoFilter): `role="dialog"` / `aria-modal`, focus
 * moves to the search input on open, Tab focus is trapped, `Esc` closes and
 * returns focus to the opener, a backdrop click closes, the input is a
 * `role="combobox"` driving a `role="listbox"` of `role="option"`s via
 * `aria-activedescendant`, the match count is announced through a polite live
 * region, and motion honours `prefers-reduced-motion`. Colours use semantic
 * tokens only.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { fuzzyRankBy } from '../lib/fuzzy-match';

/** A command group label (used to bucket commands under a heading). */
export type CommandGroup = string;

/** A single invokable command rendered as an option in the palette. */
export interface CommandItem {
  /** Stable identifier (also used to match against `recents`). */
  id: string;
  /** Human-readable, primary searchable label. */
  label: string;
  /** Optional group heading the command is bucketed under. */
  group?: CommandGroup;
  /** Extra search terms that also match this command. */
  keywords?: string[];
  /** Runs the command's effect. */
  run: () => void;
}

interface CommandPaletteProps {
  /** Whether the palette is open. */
  open: boolean;
  /** Closes the palette (and returns focus to the opener). */
  onClose: () => void;
  /** All commands offered in the palette. */
  commands: CommandItem[];
  /** Recent command ids, most-recent first; surfaced for an empty query. */
  recents?: string[];
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

/** A row in the rendered list: either a group heading or an indexed option. */
type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'option'; index: number; item: CommandItem };

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Commands matching `recents` ids, in recents order (skipping unknown ids). */
function recentCommands(commands: CommandItem[], recents: string[]): CommandItem[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const seen = new Set<string>();
  const result: CommandItem[] = [];
  for (const id of recents) {
    const command = byId.get(id);
    if (command !== undefined && !seen.has(id)) {
      seen.add(id);
      result.push(command);
    }
  }
  return result;
}

/** Buckets commands by their `group`, preserving first-appearance order. */
function groupCommands(commands: CommandItem[]): Array<{ label?: string; items: CommandItem[] }> {
  const groups: Array<{ label?: string; items: CommandItem[] }> = [];
  const indexByKey = new Map<string, number>();
  for (const command of commands) {
    const key = command.group ?? '';
    let groupIndex = indexByKey.get(key);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      indexByKey.set(key, groupIndex);
      groups.push({ label: command.group, items: [] });
    }
    groups[groupIndex].items.push(command);
  }
  return groups;
}

export function CommandPalette({ open, onClose, commands, recents }: CommandPaletteProps) {
  const titleId = useId();
  const listId = useId();
  const optionBaseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [rawQuery, setRawQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // A leading ">" forces command mode; for the shell it just strips the prefix
  // (all items are commands today) and surfaces an indicator (forward-compatible
  // with a future mixed nav + command palette).
  const isCommandMode = rawQuery.startsWith('>');
  const query = isCommandMode ? rawQuery.slice(1) : rawQuery;
  const trimmed = query.trim();

  const { rows, results } = useMemo(() => {
    const sections: Array<{ label?: string; items: CommandItem[] }> = [];

    if (trimmed === '') {
      const recent = recentCommands(commands, recents ?? []);
      if (recent.length > 0) {
        sections.push({ label: 'Recent', items: recent });
      }
      const recentIds = new Set(recent.map((command) => command.id));
      const rest = commands.filter((command) => !recentIds.has(command.id));
      sections.push(...groupCommands(rest));
    } else {
      const ranked = fuzzyRankBy(trimmed, commands, (command) => [
        command.label,
        ...(command.keywords ?? []),
      ]);
      sections.push({ items: ranked });
    }

    const builtRows: Row[] = [];
    const flat: CommandItem[] = [];
    for (const section of sections) {
      if (section.items.length === 0) {
        continue;
      }
      if (section.label !== undefined) {
        builtRows.push({ kind: 'header', key: `header-${section.label}`, label: section.label });
      }
      for (const item of section.items) {
        builtRows.push({ kind: 'option', index: flat.length, item });
        flat.push(item);
      }
    }
    return { rows: builtRows, results: flat };
  }, [commands, recents, trimmed]);
  const resultIdentity = useMemo(() => results.map((result) => result.id).join('\0'), [results]);

  // Reset the highlight to the first option whenever the actual result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [resultIdentity]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (results.length === 0) {
        return 0;
      }
      return Math.min(current, results.length - 1);
    });
  }, [results.length]);

  // Reset transient state and focus the search input each time the palette opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    setRawQuery('');
    setActiveIndex(0);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Keep the active option visible (WCAG 2.4.7 Focus Visible, #468): the active
  // descendant is the only visible keyboard-focus indicator, so scroll it into
  // the listbox viewport whenever the highlight moves while the palette is open.
  // `'nearest'` avoids gratuitous motion and is a no-op when already visible.
  useEffect(() => {
    if (!open || activeIndex < 0 || activeIndex >= results.length) {
      return;
    }
    document.getElementById(`${optionBaseId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, optionBaseId, results.length]);

  if (!open) {
    return null;
  }

  const count = results.length;
  const announcement =
    count === 0 ? 'No commands' : `${count} ${count === 1 ? 'command' : 'commands'}`;
  const activeOptionId =
    count > 0 && activeIndex >= 0 && activeIndex < count
      ? `${optionBaseId}-${activeIndex}`
      : undefined;

  function moveActive(delta: number): void {
    if (count === 0) {
      return;
    }
    setActiveIndex((current) => (current + delta + count) % count);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      if (count > 0) {
        event.preventDefault();
        setActiveIndex(0);
      }
    } else if (event.key === 'End') {
      if (count > 0) {
        event.preventDefault();
        setActiveIndex(count - 1);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex];
      if (target !== undefined) {
        runCommand(target);
      }
    }
  }

  // #417: always close (and let the open-effect restore focus) even if a real
  // command's `run` throws, so a throwing command can never strand the palette
  // open (or escape into React's event dispatch and unmount the tree). The
  // failure is surfaced via console.error rather than swallowed silently.
  function runCommand(item: CommandItem): void {
    try {
      item.run();
    } catch (error) {
      console.error(`Command "${item.id}" failed:`, error);
    } finally {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-24">
      <div
        data-testid="command-palette-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-bg/70"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
        className="relative flex max-h-[28rem] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border-strong bg-surface-overlay text-text shadow-xl"
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>
        <div
          data-testid="command-palette-live"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announcement}
        </div>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          {isCommandMode ? (
            <span
              data-testid="command-palette-mode"
              className="rounded bg-surface-selected px-1.5 py-0.5 text-xs font-medium text-text-muted"
            >
              Commands
            </span>
          ) : null}
          <label htmlFor={`${listId}-input`} className="sr-only">
            Search commands
          </label>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            value={rawQuery}
            placeholder="Type a command…"
            onChange={(event) => setRawQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            className="w-full bg-transparent text-sm text-text placeholder:text-text-muted focus:outline-none"
          />
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="flex flex-col overflow-y-auto p-1"
        >
          {count === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-text-muted">
              No commands
            </li>
          ) : (
            rows.map((row) =>
              row.kind === 'header' ? (
                <li
                  key={row.key}
                  role="presentation"
                  className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  {row.label}
                </li>
              ) : (
                <li
                  key={row.item.id}
                  id={`${optionBaseId}-${row.index}`}
                  role="option"
                  aria-selected={row.index === activeIndex}
                  onClick={() => runCommand(row.item)}
                  onMouseMove={() => setActiveIndex(row.index)}
                  className={`flex cursor-pointer items-center rounded px-3 py-2 text-sm text-text hover:bg-surface-hover ${
                    row.index === activeIndex ? 'bg-surface-selected' : ''
                  }`}
                >
                  {row.item.label}
                </li>
              ),
            )
          )}
        </ul>
      </div>
    </div>
  );
}
