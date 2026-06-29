/**
 * InboxItemRow — one actionable Inbox entry (DESIGN-INBOX §5, §6).
 *
 * Presentational: it renders a single {@link InboxItemView} and reports triage
 * intent through callbacks; it owns no state and issues no requests. Each row
 * encodes its meaning on multiple channels so it never relies on colour alone
 * (§6.2, SC 1.4.1 / 1.4.11):
 * - the **accent** (§5) paints a decorative left bar (`aria-hidden`);
 * - a **glyph + text label** names the kind/severity;
 * - **unread** is an explicit dot **and** an `sr-only` "Unread" word **and**
 *   bold weight — colour is only the last, enhancing layer.
 *
 * The title is an origin-gated GitHub link (`safeGitHubHref`, §6.2): a value
 * that fails the guard degrades to inert text instead of an off-origin link.
 * A pointer click or Enter opens the link and marks the item read (via the
 * anchor's click); Space marks read without navigating. Dismiss / Restore are
 * real, labelled buttons reachable in tab order with a visible `focus-visible`
 * ring. All colour comes from semantic theme tokens so the row recolours with a
 * single `.dark` flip and stays within the AA budget in both themes —
 * warning/coral text uses the `-ink` variants (DESIGN-TILES §1.5).
 */
import type { KeyboardEvent, ReactElement } from 'react';

import { cn } from '../../lib/cn';
import { formatRelativeTime } from '../../lib/format';
import { safeGitHubHref } from '../../lib/github-url';
import { formatRepoLabel } from '../../lib/repo-owner-preference';
import { useRepoOwner } from '../../hooks/useRepoOwner';
import type { InboxItemView } from '../../hooks/useInbox';
import type { InboxKind } from '../../types/inbox';
import { StatusGlyph } from '../tiles/StatusGlyph';
import type { AccentTone, SignalIconKind } from '../tiles/types';
import { toneBgClass } from '../tiles/types';
import { KIND_LABELS } from './labels';

/** Status glyph drawn beside each kind label (DESIGN-TILES §2.1). */
const KIND_GLYPHS: Record<InboxKind, SignalIconKind> = {
  ci: 'failure',
  review: 'review',
  'new-pr': 'external',
  security: 'warning',
  stale: 'stale',
};

/** Security severity → glyph so the (decorative) glyph colour tracks the accent (§5). */
const SECURITY_GLYPHS: Record<NonNullable<InboxItemView['severity']>, SignalIconKind> = {
  critical: 'failure',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

function itemGlyph(item: InboxItemView): SignalIconKind {
  if (item.kind === 'security' && item.severity !== undefined) {
    return SECURITY_GLYPHS[item.severity];
  }
  return KIND_GLYPHS[item.kind];
}

/**
 * Accent → text-colour class. Warning and coral use their `-ink` variants
 * (amber-800 / orange-800 in light) so accent text clears AA on tints + white;
 * the other accents already pass as normal text (DESIGN-TILES §1.5).
 */
const TONE_TEXT_CLASS: Record<AccentTone, string> = {
  success: 'text-accent-success',
  failure: 'text-accent-failure',
  warning: 'text-accent-warning-ink',
  info: 'text-accent-info',
  neutral: 'text-accent-neutral',
  coral: 'text-accent-coral-ink',
  purple: 'text-accent-purple',
  gold: 'text-accent-gold',
  ochre: 'text-accent-ochre',
};

function kindLabel(item: InboxItemView): string {
  if (item.kind === 'security' && item.severity !== undefined) {
    return `${KIND_LABELS.security} · ${item.severity}`;
  }
  return KIND_LABELS[item.kind];
}

export interface InboxItemRowProps {
  /** The decorated item to render. */
  item: InboxItemView;
  /** Marks the item read (fired on open/click). */
  onMarkRead: (id: string) => void;
  /** Dismisses (archives) the item. */
  onDismiss: (id: string) => void;
  /** Restores a previously dismissed item. */
  onRestore: (id: string) => void;
  /** Whether this row is currently selected (only meaningful with `onToggleSelect`). */
  selected?: boolean;
  /**
   * Toggles this row's selection. When provided, a leading, labelled selection
   * checkbox is rendered; when omitted the row's DOM and behaviour are unchanged.
   */
  onToggleSelect?: (id: string) => void;
}

export function InboxItemRow({
  item,
  onMarkRead,
  onDismiss,
  onRestore,
  selected = false,
  onToggleSelect,
}: InboxItemRowProps): ReactElement {
  const href = safeGitHubHref(item.url);
  const label = kindLabel(item);
  const { display } = useRepoOwner();

  function activate(): void {
    onMarkRead(item.id);
  }

  // Anchors do not natively activate on Space (the key scrolls the page), so
  // handle Space here: mark read and prevent the scroll. Enter is deliberately
  // left to the browser's native activation, which fires the click — `onClick`
  // marks read — so handling Enter here too would mark read twice (#246).
  function handleKeyDown(event: KeyboardEvent<HTMLAnchorElement>): void {
    if (event.key === ' ') {
      event.preventDefault();
      activate();
    }
  }

  const titleClass = cn('min-w-0 truncate text-text', !item.read && 'font-semibold');

  return (
    <li
      data-kind={item.kind}
      className={cn(
        'flex items-stretch gap-3 rounded-md border border-border bg-surface p-3 motion-safe:transition-colors hover:bg-surface-raised',
        item.dismissed && 'opacity-70',
        item.isNew &&
          'bg-[color-mix(in_srgb,var(--color-info)_8%,var(--color-surface))] border-border-strong',
      )}
    >
      <span
        aria-hidden="true"
        data-tone={item.accent}
        className={cn('w-1 shrink-0 self-stretch rounded-full', toneBgClass(item.accent))}
      />

      {onToggleSelect !== undefined ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select ${item.title}`}
          className="mt-0.5 h-4 w-4 shrink-0 self-start rounded border-border-strong text-accent-info focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {!item.read ? (
            <>
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent-info" />
              <span className="sr-only">Unread</span>
            </>
          ) : null}
          {href !== undefined ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={activate}
              onKeyDown={handleKeyDown}
              className={cn(
                titleClass,
                'rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              )}
            >
              {item.title}
            </a>
          ) : (
            <span className={titleClass}>{item.title}</span>
          )}
          {item.isNew ? (
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--color-info)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-info">
              New
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
          <span
            className={cn(
              'inline-flex items-center gap-1 font-medium',
              TONE_TEXT_CLASS[item.accent],
            )}
          >
            <span aria-hidden="true" className="inline-flex">
              <StatusGlyph status={itemGlyph(item)} size={14} />
            </span>
            <span>{label}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate" title={item.repo.nameWithOwner}>
            {formatRepoLabel(item.repo, display)}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.timestamp}>{formatRelativeTime(item.timestamp)}</time>
        </div>
      </div>

      <div className="flex shrink-0 items-start">
        {item.dismissed ? (
          <button
            type="button"
            onClick={() => onRestore(item.id)}
            aria-label={`Restore ${item.title}`}
            className="rounded border border-border-strong px-2 py-1 text-xs font-medium text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            aria-label={`Dismiss ${item.title}`}
            className="rounded border border-border-strong px-2 py-1 text-xs font-medium text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}
