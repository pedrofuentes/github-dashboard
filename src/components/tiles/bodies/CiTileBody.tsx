import type { ReactElement } from 'react';

import type { Density } from '../../../lib/density-preference';
import { formatRelativeTime } from '../../../lib/format';
import { safeGitHubHref } from '../../../lib/github-url';
import type { CiSignalSlice, Repo, RepoSignalData } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { RunStrip } from '../RunStrip';
import type { RunConclusion } from '../RunStrip';
import { StatusGlyph } from '../StatusGlyph';
import { TileMessage } from '../TileMessage';
import type { AccentTone, SignalIconKind, TileTier } from '../types';
import { iconKindTone } from '../types';

export interface CiTileBodyProps {
  /** The repo this CI signal belongs to (used for accessible context). */
  repo: Repo;
  /** The repo's resolved signal payload; `data.ci` is the CI slice. */
  data: RepoSignalData;
  /** Density tier the surrounding tile renders at (DESIGN-TILES §3.4). */
  size: TileTier;
  /**
   * Tile density (DESIGN-TILES §6; T15). In `glanceable` the standard tier
   * sheds its micro-viz/meta so only the hero + delta remain; `balanced` (the
   * default) keeps them, and compact/expanded are unaffected.
   */
  density?: Density;
}

type Conclusion = NonNullable<CiSignalSlice['conclusion']>;

/**
 * Conclusion → glyph kind + status word (DESIGN-TILES §2.1, §4.1). The tone is
 * derived from the glyph via {@link iconKindTone} so glyph, glow and word stay
 * on one accent: success→success/✓, failure→failure/✗, in_progress→warning/
 * spinner, queued→info/clock, none→neutral/—.
 */
const CONCLUSION: Record<Conclusion, { glyph: SignalIconKind; word: string }> = {
  success: { glyph: 'success', word: 'Passing' },
  failure: { glyph: 'failure', word: 'Failing' },
  in_progress: { glyph: 'running', word: 'Running' },
  queued: { glyph: 'queued', word: 'Queued' },
  none: { glyph: 'neutral', word: 'No runs' },
};

/** Hero glyph pixel size per density tier. */
const GLYPH_SIZE: Record<TileTier, number> = {
  compact: 32,
  standard: 44,
  expanded: 60,
};

interface CiView {
  /** Which presentational state the body settled into (drives `data-state`). */
  state: 'ready' | 'unavailable' | 'loading' | 'error';
  /** Which status glyph to render as the hero. */
  glyph: SignalIconKind;
  /** Accent shared by glyph, glow and the status word. */
  tone: AccentTone;
  /** Visible status word (BigValue at standard/expanded). */
  word: string;
  /** Muted secondary line; omitted when there is nothing to add. */
  detail?: string;
  /** Failing workflow count (> 0 only) — the numeric redundant encoding. */
  failing: number;
  /** Latest-run conclusion to feed the RunStrip (ready state only). */
  runConclusion?: RunConclusion;
  /** Latest-run recency (`formatRelativeTime(updatedAt)`); ready state only. */
  recency?: string;
  /** Full sr-only sentence — the redundant text layer, never blank. */
  sr: string;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Collapse the CI slice (and its lifecycle status) into a single presentational
 * descriptor. Every branch yields a glyph, tone, word and sr sentence so the
 * body is never blank and state is encoded redundantly (glyph + word + colour +
 * sr-text), per DESIGN-TILES §3.6 and §4.1.
 */
function resolveView(ci: CiSignalSlice | undefined, repoLabel: string): CiView {
  if (!ci || ci.status === 'unknown') {
    return {
      state: 'unavailable',
      glyph: 'neutral',
      tone: 'neutral',
      word: 'n/a',
      failing: 0,
      sr: `CI status unavailable for ${repoLabel}`,
    };
  }

  if (ci.status === 'loading') {
    return {
      state: 'loading',
      glyph: 'loading',
      tone: 'neutral',
      word: 'Loading…',
      failing: 0,
      sr: 'Loading CI…',
    };
  }

  if (ci.status === 'error') {
    return {
      state: 'error',
      glyph: 'failure',
      tone: 'failure',
      word: "Couldn't load CI",
      failing: 0,
      sr: 'CI status could not be loaded',
    };
  }

  // GitHub exposes conclusions beyond our 5-member enum (cancelled, skipped,
  // timed_out, action_required, neutral, stale). Guard the lookup so an
  // unexpected value falls back to the neutral 'none' render instead of
  // throwing a TypeError → blank tile (#185). `Object.hasOwn` (not the `in`
  // operator) keeps the guard to the enum's own keys, so an inherited
  // Object.prototype member ("toString", "constructor", …) cannot resolve to a
  // prototype method and destructure an undefined glyph/word (#204).
  const raw = ci.conclusion ?? 'none';
  const isKnownConclusion = Object.hasOwn(CONCLUSION, raw);
  if (!isKnownConclusion) {
    // Effectively unreachable — useCiSignal.summarize() already normalizes every
    // conclusion to an enum member upstream. Warn rather than fall back silently
    // so a regression in that normalization is observable in dev instead of being
    // masked by the neutral render, mirroring the unexpected-value warns in
    // useTileSize / the signal hooks (#365 🟢#2). The 'none' fallback below still
    // keeps the tile non-blank.
    console.warn(
      `CiTileBody: unexpected CI conclusion "${raw}"; falling back to the neutral "No runs" ` +
        `render. useCiSignal.summarize() is expected to normalize conclusions upstream.`,
    );
  }
  const conclusion: Conclusion = isKnownConclusion ? raw : 'none';
  const { glyph, word } = CONCLUSION[conclusion];
  const tone = iconKindTone(glyph);
  const failing = typeof ci.failingCount === 'number' && ci.failingCount > 0 ? ci.failingCount : 0;
  const detail = failing > 0 ? `${failing} failing` : 'No failing workflows';
  const recency = ci.updatedAt ? formatRelativeTime(ci.updatedAt) : undefined;
  const sr =
    failing > 0
      ? `CI ${word.toLowerCase()} — ${plural(failing, 'workflow')} failing`
      : `CI ${word.toLowerCase()}`;

  return {
    state: 'ready',
    glyph,
    tone,
    word,
    detail,
    failing,
    runConclusion: conclusion,
    recency,
    sr,
  };
}

/**
 * Bespoke CI / Actions tile body (DESIGN-TILES §4.1). Presentational only — the
 * shared `TileFrame` supplies the accent bar, salience edge/tint/glow, header
 * and activate/edit chrome; this renders the inner CI visual: a hero
 * `StatusGlyph`, the run-state word as `BigValue`, the failing count, a single
 * shape-coded latest-run cell (`RunStrip`) at standard/expanded, the latest-run
 * recency, and — at the expanded tier — a GitHub-origin-gated "View latest run"
 * deep link.
 *
 * The body does NOT paint the top edge or its own glow: per redesign R3 the
 * `TileFrame` owns the PROBLEM glow, so the body (the only former `AmbientGlow`
 * caller) no longer double-glows on failure.
 *
 * DEFERRED (no new fetch — see plan T7 Data availability): the CI hook retains
 * only the latest run, so there is no win/loss history, no passing count and no
 * "▲ since yesterday" delta. The 10-cell history strip is reduced to one
 * `RunStrip` cell; a real history needs a windowed Actions fetch (out of scope).
 *
 * State is encoded redundantly (glyph + word + colour + sr-text) and the body is
 * never blank: loading, error, unknown and all-clear all render a positive,
 * labelled state.
 */
export function CiTileBody({
  repo,
  data,
  size,
  density = 'balanced',
}: CiTileBodyProps): ReactElement {
  const ci = data.ci;

  // T16 missing-states matrix: route loading + failed-to-load through the shared
  // TileMessage so every body shows the same calm, redundant state row. CI has
  // no zero-`0` "all-clear" takeover — its calm ready state is the passing hero
  // (success glyph), already visually distinct from this ⚠ failed row. The
  // `unknown`/no-slice "n/a" neutral state is NOT part of the matrix (it maps to
  // the deferred `not-configured`) and keeps its existing treatment below.
  if (ci?.status === 'loading') {
    return <TileMessage kind="loading" message="Loading…" srText="Loading CI…" />;
  }
  if (ci?.status === 'error') {
    return (
      <TileMessage
        kind="failed"
        message="Couldn't load CI"
        srText="CI status could not be loaded"
      />
    );
  }

  const view = resolveView(ci, repo.nameWithOwner);

  // Glanceable standard sheds the standard-tier extras (the latest-run cell and
  // recency) so only the hero + count remain; balanced and expanded keep them.
  const showStandardExtras = density === 'balanced' || size === 'expanded';
  const href = size === 'expanded' ? safeGitHubHref(ci?.latestRunUrl) : undefined;
  const showWord = size !== 'compact';
  const showDetail = view.detail !== undefined && (size !== 'compact' || view.failing > 0);
  const showStrip = size !== 'compact' && view.runConclusion !== undefined && showStandardExtras;
  const showRecency = size !== 'compact' && view.recency !== undefined && showStandardExtras;

  return (
    <div
      data-state={view.state}
      className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-center"
    >
      <div className="flex flex-col items-center gap-1">
        <StatusGlyph status={view.glyph} size={GLYPH_SIZE[size]} title={view.word} />

        {showWord ? <BigValue value={view.word} tone={view.tone} size={size} /> : null}

        {showDetail ? <span className="text-sm text-text-muted">{view.detail}</span> : null}

        {showStrip ? (
          <RunStrip
            conclusion={view.runConclusion as RunConclusion}
            srLabel={`Latest run ${view.word.toLowerCase()}`}
          />
        ) : null}

        {showRecency ? <span className="text-xs text-text-muted">{view.recency}</span> : null}

        {/*
          INTERIM (§4.1): the canonical "View latest run" affordance belongs in
          the tile footer, but footer action wiring is not yet in place, so the
          expanded tier renders the deep link in-body. Move to the footer once
          that affordance lands; the GitHub-origin gate (`safeGitHubHref`) stays.
        */}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex rounded text-sm font-medium text-accent-info hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            View latest run
          </a>
        ) : null}

        <span className="sr-only">{view.sr}</span>
      </div>
    </div>
  );
}
