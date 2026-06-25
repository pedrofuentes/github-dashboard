/**
 * BoardKey — one Stream Deck-style square "key" for a (repo, signal) pair.
 *
 * This is the presentational sibling of the pure {@link boardKeySpec} mapper: it
 * takes the render-agnostic {@link BoardKeySpec} that module emits and paints the
 * pixel-faithful Stream Deck key anatomy (sdgh-design-spec §2) — a rounded
 * square with a 6px top accent bar and three centred rows (repo label · hero
 * value **or** status icon · caption). The spec owns *what* to show (state,
 * layout, accent, lines); this component owns *how* it looks, scaled to the
 * app's semantic-token theme.
 *
 * Colour fidelity: the Stream Deck source uses raw GitHub-dark hex; here every
 * colour is a token. The accent (top bar, ready icon, error glyph, spinner) is
 * the spec's {@link BoardKeySpec.accent} resolved to a `var(--color-*)` via
 * {@link BOARD_KEY_ACCENT_VAR}; everything else uses Tailwind token classes
 * (`bg-surface`, `text-text`, `text-text-muted`, …). No raw hex, so the `.dark`
 * class flips the whole key.
 *
 * Lifecycle: `loading` shows a reduced-motion-safe spinner, `error` a distinct
 * "couldn't load" warning glyph on a `warning` accent (deliberately NOT the
 * CI-failure red ×) — keeping the signal label and, when `onRetry` is wired,
 * adding a "Retry" affordance — and `empty` an explicit `n/a`; all token-only
 * and uniform across both layouts.
 *
 * Accessibility: the repo label line honours the owner show/hide setting (it can
 * render the bare repo name), but the key's accessible name ALWAYS carries the
 * full `repo.nameWithOwner` + the signal + the value/status, so a screen-reader
 * user keeps full context even when the owner is visually hidden. The whole key
 * is a `<button>` (native Enter/Space + the `focus`-token ring) when it can act
 * on a press — a retryable `error` (press ⇒ `onRetry`, labelled "Retry {signal}
 * for {repo}") or a drill-down (`onActivate`, press ⇒ activate); otherwise it is
 * a non-interactive container with an `sr-only` summary. `data-signal` /
 * `data-layout` / `data-state` are stable seams for tests and the grid.
 */
import type { ReactElement, ReactNode } from 'react';

import { useRepoOwner } from '../../hooks/useRepoOwner';
import { BOARD_KEY_ACCENT_VAR, boardKeySpec } from '../../lib/board/board-key-spec';
import type { BoardActivityInput, BoardKeySpec } from '../../lib/board/board-key-spec';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import { formatRepoLabel } from '../../lib/repo-owner-preference';
import type { TileSignalType } from '../../types/dashboard';
import type { Repo, RepoSignalData } from '../../types/fleet';
import { BoardStatusIcon } from './BoardStatusIcon';

export interface BoardKeyProps {
  /** The repository this key represents (drives the label + accessible name). */
  repo: Repo;
  /** Which signal this key renders. */
  signal: TileSignalType;
  /** The repo's aggregated signal slices (the spec reads `data[signal]`). */
  data: RepoSignalData;
  /** Activity value + lifecycle — it has no `RepoSignalData` slice (§spec). */
  activity?: BoardActivityInput;
  /** When supplied, the key becomes a button that activates the repo on press. */
  onActivate?: (repo: Repo) => void;
  /**
   * Re-fetch handler for a failed signal. When the key is in its `error` state
   * and this is provided, the key becomes a *retry* button (its press calls
   * `onRetry` instead of `onActivate`), so a load failure is recoverable in
   * place. Ignored in every non-error state.
   */
  onRetry?: () => void;
}

/** Shared root box — the rounded Stream Deck square (sdgh-design-spec §2.1). */
const ROOT_CLASS =
  'relative flex aspect-square w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm';

/**
 * State/value phrase folded into the accessible name (never colour-only). When
 * the spec carries a `srLabel` override (e.g. the security no-access key), that
 * text replaces the default phrase so screen-reader users get the full reason.
 * Ready value keys otherwise read "<value> <caption>" (e.g. "12 Open Issues");
 * ready icon keys read the status label; lifecycle states read a plain state word.
 */
function accessibleStatus(spec: BoardKeySpec): string {
  if (spec.srLabel !== undefined) {
    return spec.srLabel;
  }
  if (spec.state === 'loading') {
    return 'Loading';
  }
  if (spec.state === 'error') {
    return 'Failed to load';
  }
  if (spec.state === 'empty') {
    return spec.layout === 'icon' ? spec.line3 : 'No data';
  }
  return spec.layout === 'value' ? `${spec.line2} ${spec.line3}` : spec.line3;
}

/**
 * The key's centre slot. State takes precedence over layout so every loading
 * key spins, every error key shows the "couldn't load" glyph (a warning sign —
 * deliberately NOT the CI-failure ×), and every empty key shows an explicit
 * "n/a"; a `ready` key then resolves to its hero value or status icon. When the
 * error is recoverable (`retryable`) a small "Retry" affordance sits under the
 * glyph. The accent colour rides `currentColor`/the bar via {@link accentVar}.
 */
function renderCenter(spec: BoardKeySpec, accentVar: string, retryable: boolean): ReactNode {
  if (spec.state === 'loading') {
    return (
      <span
        data-part="spinner"
        className="inline-flex animate-spin motion-reduce:animate-none"
        style={{ color: accentVar }}
      >
        <svg width={40} height={40} viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r="14"
            stroke="currentColor"
            strokeWidth="3"
            strokeOpacity="0.25"
          />
          <path
            d="M18 4 a14 14 0 0 1 14 14"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (spec.state === 'error') {
    return (
      <span
        data-part="error-glyph"
        className="inline-flex flex-col items-center gap-1"
        style={{ color: accentVar }}
      >
        <BoardStatusIcon status="action_required" size={retryable ? 32 : 40} />
        {retryable ? (
          <span
            data-part="retry-hint"
            className="text-[10px] font-semibold uppercase leading-none tracking-wide"
          >
            Retry
          </span>
        ) : null}
      </span>
    );
  }
  if (spec.state === 'empty') {
    return (
      <span data-part="empty" className="text-3xl font-semibold leading-none text-text-muted">
        n/a
      </span>
    );
  }
  if (spec.layout === 'icon') {
    return (
      <span data-part="icon" className="inline-flex" style={{ color: accentVar }}>
        <BoardStatusIcon status={spec.status ?? 'neutral'} size={40} />
      </span>
    );
  }
  return (
    <span data-part="value" className="text-4xl font-semibold leading-none tabular-nums text-text">
      {spec.line2}
    </span>
  );
}

export function BoardKey({
  repo,
  signal,
  data,
  activity,
  onActivate,
  onRetry,
}: BoardKeyProps): ReactElement {
  const { display } = useRepoOwner();
  const spec = boardKeySpec(signal, data, activity);
  const accentVar = BOARD_KEY_ACCENT_VAR[spec.accent];
  const repoLabel = formatRepoLabel(repo, display);

  // A failed signal is recoverable in place: when `onRetry` is wired the error
  // key's press re-fetches instead of drilling down. Every other state keeps the
  // `onActivate` drill-down (when one is provided).
  const retryable = spec.state === 'error' && onRetry !== undefined;
  const handlePress = retryable
    ? onRetry
    : onActivate !== undefined
      ? () => onActivate(repo)
      : undefined;

  // Always the FULL nameWithOwner — independent of the visual owner setting. A
  // retryable error reads as a retry action; every other state keeps the details
  // label. The visible signal label (spec.line3) is never folded away here.
  const accessibleName = retryable
    ? `Retry ${SIGNAL_LABELS[signal]} for ${repo.nameWithOwner}`
    : `${SIGNAL_LABELS[signal]}: ${accessibleStatus(spec)} — ${repo.nameWithOwner}`;

  // The visible face is decorative (aria-hidden); the accessible name is carried
  // by the button label / the sr-only summary so it is never read twice.
  const face = (
    <>
      <div
        aria-hidden="true"
        data-part="accent-bar"
        className="h-[6px] w-full shrink-0"
        style={{ backgroundColor: accentVar }}
      />
      <div
        aria-hidden="true"
        className="flex min-h-0 flex-1 flex-col items-center gap-1 p-3 text-center"
      >
        <span
          data-part="line1"
          title={repo.nameWithOwner}
          className="w-full truncate text-xs font-medium text-text-muted"
        >
          {repoLabel}
        </span>
        <span data-part="center" className="flex min-h-0 flex-1 items-center justify-center">
          {renderCenter(spec, accentVar, retryable)}
        </span>
        <span data-part="line3" className="w-full truncate text-xs text-text-muted">
          {spec.line3}
        </span>
      </div>
    </>
  );

  if (handlePress !== undefined) {
    return (
      <button
        type="button"
        data-signal={signal}
        data-layout={spec.layout}
        data-state={spec.state}
        data-accent={spec.accent}
        aria-label={accessibleName}
        title={spec.srLabel}
        onClick={handlePress}
        className={`${ROOT_CLASS} text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
      >
        {face}
      </button>
    );
  }

  return (
    <div
      data-signal={signal}
      data-layout={spec.layout}
      data-state={spec.state}
      data-accent={spec.accent}
      title={spec.srLabel}
      className={ROOT_CLASS}
    >
      {face}
      <span className="sr-only">{accessibleName}</span>
    </div>
  );
}
