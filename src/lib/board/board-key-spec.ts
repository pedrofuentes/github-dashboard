/**
 * Pure Board-view "Stream Deck key" spec mapper (no React / no DOM).
 *
 * The upcoming Board view replicates the pixel-faithful layout of the
 * `pedrofuentes/stream-deck-github-utilities` plugin: each repo signal becomes a
 * square "key" with a repo-name line, a hero value **or** a status icon, and a
 * caption line. This module is the single source of truth that turns a
 * `(signal, data)` pairing into a render-agnostic {@link BoardKeySpec} — the
 * key component (and the grid that lays the keys out) consume the spec; they own
 * the actual DOM/SVG. The sibling status-icon component renders an icon from the
 * emitted {@link BoardKeySpec.status} string — this module never renders icons.
 *
 * Colour fidelity: the Stream Deck source uses raw GitHub-dark hex. This
 * dashboard is token-based and theme-aware, so every colour maps to the app's
 * existing {@link AccentTone} set (resolved to a CSS custom property via
 * {@link BOARD_KEY_ACCENT_VAR}); raw hex never appears here. The Stream Deck
 * "light purple"/"gold"/"salmon" extras collapse onto the nearest existing
 * tokens — there is intentionally no new token (that would be an architecture
 * change). The only mapping that needs the nearest-token rule is the Stream
 * Deck loading accent (`COLORS.border`, a dark-gray hairline with no accent
 * token): it maps to the nearest token, `neutral`.
 */
import type { AccentTone } from '../../components/tiles/types';
import type { TileSignalType } from '../../types/dashboard';
import type { CiSignalSlice, RepoSignalData, SignalStatus } from '../../types/fleet';

/** Lifecycle of a board key, derived from the owning signal slice's status. */
export type BoardKeyState = 'loading' | 'error' | 'empty' | 'ready';

/** Whether the key shows a hero value (`value`) or a status icon (`icon`). */
export type BoardKeyLayout = 'value' | 'icon';

/**
 * Render-agnostic description of one Board key.
 *
 * `line2` is the hero value for `value` layouts and is empty for `icon` layouts
 * (the icon fills that slot). `line3` is the caption. `status` is only present
 * for the CI key in its `ready` state — a Stream Deck workflow status string the
 * icon component maps to a glyph. `srLabel` is an optional accessible-status
 * override that, when set, replaces the default `"${line2} ${line3}"` phrase in
 * the key's accessible name and is also exposed as a `title` tooltip on the root
 * element (e.g. the security no-access key uses it to carry the missing-scope
 * explanation). (The repo-name line is supplied by the component from its own
 * context, so it is not part of this spec.)
 */
export interface BoardKeySpec {
  state: BoardKeyState;
  layout: BoardKeyLayout;
  accent: AccentTone;
  line2: string;
  line3: string;
  status?: string;
  /**
   * Optional accessible-status override. When set, replaces the default
   * `"${line2} ${line3}"` phrase in the key's accessible name and is rendered
   * as a `title` tooltip on the root element for hover context. Intended for
   * cases where the visible hero value alone does not convey the full reason
   * (e.g. "n/a" with no explanation for a no-access security key).
   */
  srLabel?: string;
}

/**
 * Activity input. Activity has no {@link RepoSignalData} slice (it is fetched
 * separately), so its value + lifecycle are passed alongside `data`.
 */
export interface BoardActivityInput {
  commitsThisWeek?: number;
  status?: SignalStatus;
}

/**
 * Semantic accent tone → theme-aware CSS custom-property reference.
 *
 * Chosen representation: a `var(--color-*)` string (NOT a Tailwind class), so a
 * consumer can use it directly as an SVG `fill`/`stroke`, an inline `style`, or
 * a `color-mix` tint — and it flips with the `.dark` theme class with no raw
 * hex. It mirrors the canonical `toneToVar` map in `components/tiles/types.ts`;
 * keeping a literal copy keeps this pure lib free of any runtime component
 * import. The `--color-*` names are defined per theme in `src/index.css`.
 */
export const BOARD_KEY_ACCENT_VAR: Record<AccentTone, string> = {
  success: 'var(--color-success)',
  failure: 'var(--color-failure)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  neutral: 'var(--color-neutral)',
  coral: 'var(--color-coral)',
  purple: 'var(--color-purple)',
  gold: 'var(--color-gold)',
  ochre: 'var(--color-ochre)',
};

/**
 * Compact large-number formatter (Stream Deck design-spec §4.1).
 *
 * `<1000` as-is; then `k`/`M`/`B` suffixes via `parseFloat((n/scale).toFixed(1))`
 * (which strips trailing `.0`, so `1000 → "1k"`, `47100 → "47.1k"`). Negatives
 * recurse on the magnitude with a `-` prefix. Inputs are expected to be finite
 * non-negative integers (callers coalesce `undefined → 0`); the board's own
 * `M`-capped sibling lives in `lib/format.ts`, which is why this `B`-aware copy
 * is co-located here instead of reused.
 */
export function formatCount(n: number): string {
  if (n < 0) {
    return `-${formatCount(Math.abs(n))}`;
  }
  if (n < 1_000) {
    return String(n);
  }
  if (n < 1_000_000) {
    return `${parseFloat((n / 1_000).toFixed(1))}k`;
  }
  if (n < 1_000_000_000) {
    return `${parseFloat((n / 1_000_000).toFixed(1))}M`;
  }
  return `${parseFloat((n / 1_000_000_000).toFixed(1))}B`;
}

/** Caption + ready-accent for each hero-value signal (CI is handled separately). */
const VALUE_LABEL: Record<Exclude<TileSignalType, 'ci'>, string> = {
  issues: 'Open Issues',
  pullRequests: 'Open PRs',
  reviews: 'Reviews',
  security: 'Security',
  stale: 'Stale',
  activity: 'Commits (7d)',
};

const VALUE_ACCENT: Record<Exclude<TileSignalType, 'ci'>, AccentTone> = {
  issues: 'success',
  pullRequests: 'success',
  reviews: 'info',
  security: 'neutral', // overridden per grade when ready
  stale: 'neutral',
  activity: 'coral',
};

type NonReadyState = Exclude<BoardKeyState, 'ready'>;

/** Accent for a non-ready key: error → warning (a distinct "couldn't load"
 * tone, NOT the CI-failure red), else neutral. */
const NON_READY_ACCENT: Record<NonReadyState, AccentTone> = {
  loading: 'neutral',
  error: 'warning',
  empty: 'neutral',
};

/** Hero-value placeholder for a non-ready value key. */
const NON_READY_VALUE: Record<NonReadyState, string> = {
  loading: '…',
  error: '—',
  empty: '—',
};

/** Caption for a non-ready CI key (CI's ready caption is a status label). */
const CI_STATE_LABEL: Record<NonReadyState, string> = {
  loading: 'Loading',
  error: 'Error',
  empty: 'No Runs',
};

/** Stream Deck workflow status derivable from {@link CiSignalSlice.conclusion}. */
type CiStatus = 'success' | 'failure' | 'in_progress' | 'queued' | 'neutral';

const CI_STATUS_ACCENT: Record<CiStatus, AccentTone> = {
  success: 'success',
  failure: 'failure',
  in_progress: 'warning', // §7: In Progress = amber
  queued: 'info', // §7: Queued = blue
  neutral: 'neutral',
};

/** Human status label (Stream Deck design-spec §3.1). */
const CI_STATUS_LABEL: Record<CiStatus, string> = {
  success: 'Success',
  failure: 'Failed',
  in_progress: 'Running',
  queued: 'Queued',
  neutral: 'Neutral',
};

/** Letter grade → accent (§1.12): A/B success, C warning, D–F failure. */
function gradeAccent(grade: NonNullable<RepoSignalData['security']>['grade']): AccentTone {
  switch (grade) {
    case 'A':
    case 'B':
      return 'success';
    case 'C':
      return 'warning';
    case 'D':
    case 'E':
    case 'F':
      return 'failure';
    default:
      return 'neutral';
  }
}

function ciStatus(conclusion: CiSignalSlice['conclusion']): CiStatus {
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'in_progress':
      return 'in_progress';
    case 'queued':
      return 'queued';
    default:
      return 'neutral'; // 'none' or absent → neutral (no runs)
  }
}

/**
 * Resolve a key's lifecycle state from its owning slice:
 * absent slice → `empty` (no data); a present slice with a missing status field
 * → `loading` (defensive, before first fetch); otherwise by status
 * (`ready`/`error`/`loading`, and `unknown` → `empty`).
 */
function resolveState(slice: { status?: SignalStatus } | undefined): BoardKeyState {
  if (!slice) {
    return 'empty';
  }
  switch (slice.status) {
    case 'ready':
      return 'ready';
    case 'error':
      return 'error';
    case 'loading':
      return 'loading';
    case 'unknown':
      return 'empty';
    default:
      return 'loading';
  }
}

function ciKeySpec(ci: CiSignalSlice | undefined): BoardKeySpec {
  const state = resolveState(ci);
  if (state !== 'ready') {
    return {
      state,
      layout: 'icon',
      accent: NON_READY_ACCENT[state],
      line2: '',
      line3: CI_STATE_LABEL[state],
    };
  }
  const status = ciStatus(ci?.conclusion);
  return {
    state,
    layout: 'icon',
    accent: CI_STATUS_ACCENT[status],
    line2: '',
    line3: CI_STATUS_LABEL[status],
    status,
  };
}

/** Resolve the hero value + ready accent for a value signal's `ready` state. */
function readyValue(
  signal: Exclude<TileSignalType, 'ci'>,
  data: RepoSignalData,
  activity: BoardActivityInput | undefined,
): { line2: string; accent: AccentTone; srLabel?: string } {
  switch (signal) {
    case 'issues':
      return { line2: formatCount(data.issues?.openCount ?? 0), accent: VALUE_ACCENT.issues };
    case 'pullRequests':
      return {
        line2: formatCount(data.pullRequests?.openCount ?? 0),
        accent: VALUE_ACCENT.pullRequests,
      };
    case 'reviews':
      return {
        line2: formatCount(data.reviews?.requestedCount ?? 0),
        accent: VALUE_ACCENT.reviews,
      };
    case 'stale':
      return { line2: formatCount(data.stale?.staleCount ?? 0), accent: VALUE_ACCENT.stale };
    case 'activity':
      return { line2: formatCount(activity?.commitsThisWeek ?? 0), accent: VALUE_ACCENT.activity };
    case 'security': {
      const grade = data.security?.grade;
      // No grade means the alert feeds were inaccessible (PAT lacks the
      // security_events scope or the feature is disabled). Show "n/a" as the
      // hero value AND attach srLabel so screen-reader/hover users get the same
      // context the grid cell already provides via its title/sr-only.
      if (!grade) {
        return {
          line2: 'n/a',
          accent: gradeAccent(undefined),
          srLabel: 'No security-alert access for this repository (token scope or feature disabled)',
        };
      }
      return { line2: grade, accent: gradeAccent(grade) };
    }
  }
}

/**
 * Map a repo signal + its data to a {@link BoardKeySpec}. Total and
 * deterministic: every signal/state resolves to a concrete spec, with no I/O and
 * no reads beyond the passed slices. Activity is read from `activity` (it has no
 * slice in `data`); all other signals read `data[signal]`.
 */
export function boardKeySpec(
  signal: TileSignalType,
  data: RepoSignalData,
  activity?: BoardActivityInput,
): BoardKeySpec {
  if (signal === 'ci') {
    return ciKeySpec(data.ci);
  }

  const line3 = VALUE_LABEL[signal];
  const slice = signal === 'activity' ? activity : data[signal];
  const state = resolveState(slice);

  if (state !== 'ready') {
    return {
      state,
      layout: 'value',
      accent: NON_READY_ACCENT[state],
      line2: NON_READY_VALUE[state],
      line3,
    };
  }

  const { line2, accent, srLabel } = readyValue(signal, data, activity);
  return {
    state,
    layout: 'value',
    accent,
    line2,
    line3,
    ...(srLabel !== undefined && { srLabel }),
  };
}
