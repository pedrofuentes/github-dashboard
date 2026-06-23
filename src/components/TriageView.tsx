/**
 * TriageView — the attention-first "what needs me right now?" home surface
 * (T-g1). It answers "which repos need me?" by grouping the fleet into urgency
 * bands (worst-first) rather than listing every repo equally:
 *
 *   Needs attention → Waiting on me → Community → Watch → Healthy
 *
 * Each repo appears in its HIGHEST applicable band only (precedence + dedup via
 * {@link buildTriageModel}). Every band is a labelled section with a count; the
 * Healthy band collapses to a count by default (same `aria-expanded` pattern as
 * the Fleet Matrix). The per-repo status indicators REUSE the existing per-signal
 * cell atoms, so this surface never invents a new status vocabulary.
 *
 * It mirrors {@link FleetGrid}/{@link FleetMatrix} for the shared loading
 * (skeletons), error (alert + retry), and empty states, and exposes the same
 * `onRepoActivate(repo)` drill-down contract. When the whole fleet is healthy it
 * shows a friendly "All clear" state instead of an empty Healthy band.
 */
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  TRIAGE_BAND_LABELS,
  buildTriageModel,
  hasFailingCi,
  hasIssuesOverThreshold,
  hasSecurityRisk,
  hasSecurityWarning,
  hasStaleItems,
  type TriageBand,
} from '../lib/triage-groups';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { CiCell } from './columns/CiCell';
import { IssuesCell } from './columns/IssuesCell';
import { PullRequestsCell } from './columns/PullRequestsCell';
import { RepoCell } from './columns/RepoCell';
import { ReviewsCell } from './columns/ReviewsCell';
import { SecurityCell } from './columns/SecurityCell';
import { StaleCell } from './columns/StaleCell';

const SKELETON_ROWS = 5;

interface TriageViewProps {
  /** Repositories to triage (already adapted by `useRepos`). */
  repos: Repo[];
  /** Resolves per-repo signal data (same contract as the grid/matrix). */
  getRowData: GetRowData;
  /** Drill-down hook: when provided, each repo row becomes an activation button. */
  onRepoActivate?: (repo: Repo) => void;
  /** True while a fetch is in flight (skeletons on first load). */
  loading?: boolean;
  /** Fetch error message; renders an alert + retry instead of the bands. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
}

/**
 * Renders the compact signal indicator(s) relevant to a repo's band, reusing the
 * existing per-signal cell atoms. Only the signals that put the repo in the band
 * are shown, so the row stays focused on why it needs attention.
 */
function BandIndicators({ band, data }: { band: TriageBand; data: RepoSignalData }): ReactNode {
  switch (band) {
    case 'needs-attention':
      return (
        <>
          {hasFailingCi(data) ? <CiCell slice={data.ci} /> : null}
          {hasSecurityRisk(data) ? <SecurityCell slice={data.security} /> : null}
          {hasIssuesOverThreshold(data) ? <IssuesCell slice={data.issues} /> : null}
        </>
      );
    case 'waiting-on-me':
      return <ReviewsCell slice={data.reviews} />;
    case 'community':
      return <PullRequestsCell slice={data.pullRequests} />;
    case 'watch':
      return (
        <>
          {hasStaleItems(data) ? <StaleCell slice={data.stale} /> : null}
          {hasSecurityWarning(data) ? <SecurityCell slice={data.security} /> : null}
        </>
      );
    case 'healthy':
      return null;
  }
}

interface RepoRowProps {
  repo: Repo;
  band: TriageBand;
  getRowData: GetRowData;
  onRepoActivate?: (repo: Repo) => void;
}

/** A single repo row: its name, the band's signal indicators, and drill-down. */
function RepoRow({ repo, band, getRowData, onRepoActivate }: RepoRowProps) {
  const data = getRowData(repo);
  const indicators = (
    <span className="flex flex-wrap items-center gap-2">
      <BandIndicators band={band} data={data} />
    </span>
  );

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 hover:bg-surface-hover">
      {onRepoActivate ? (
        <button
          type="button"
          onClick={() => onRepoActivate(repo)}
          aria-label={`View details for ${repo.nameWithOwner}`}
          className="flex min-w-0 flex-1 items-center rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <RepoCell repo={repo} />
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center">
          <RepoCell repo={repo} />
        </span>
      )}
      {indicators}
    </li>
  );
}

interface BandSectionProps {
  band: TriageBand;
  repos: Repo[];
  getRowData: GetRowData;
  onRepoActivate?: (repo: Repo) => void;
}

/** A worst-first attention band as a labelled section with a count + repo list. */
function BandSection({ band, repos, getRowData, onRepoActivate }: BandSectionProps) {
  const headingId = useId();
  const label = TRIAGE_BAND_LABELS[band];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        <span>{label}</span>
        <span className="ml-2 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium tabular-nums text-text-muted">
          {repos.length}
        </span>
      </h3>
      <ul className="flex flex-col gap-2">
        {repos.map((repo) => (
          <RepoRow
            key={repo.nameWithOwner}
            repo={repo}
            band={band}
            getRowData={getRowData}
            onRepoActivate={onRepoActivate}
          />
        ))}
      </ul>
    </section>
  );
}

interface HealthyBandProps {
  repos: Repo[];
  getRowData: GetRowData;
  onRepoActivate?: (repo: Repo) => void;
}

/** The Healthy band: a collapsible count, collapsed by default (`aria-expanded`). */
function HealthyBand({ repos, getRowData, onRepoActivate }: HealthyBandProps) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const label = TRIAGE_BAND_LABELS.healthy;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="sr-only">{label}</h3>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={regionId}
        className="flex w-full items-center gap-2 rounded text-left text-sm font-medium text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <svg
          className="h-4 w-4 transition-transform motion-reduce:transition-none"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>
          {label} · {repos.length}
        </span>
      </button>
      {expanded ? (
        <ul id={regionId} className="flex flex-col gap-2">
          {repos.map((repo) => (
            <RepoRow
              key={repo.nameWithOwner}
              repo={repo}
              band="healthy"
              getRowData={getRowData}
              onRepoActivate={onRepoActivate}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function TriageView({
  repos,
  getRowData,
  onRepoActivate,
  loading = false,
  error = null,
  onRetry,
}: TriageViewProps) {
  const model = useMemo(() => buildTriageModel(repos, getRowData), [repos, getRowData]);

  if (error !== null) {
    return (
      <section aria-label="Triage" className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-md border border-accent-failure bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] px-4 py-3 text-sm text-accent-failure"
        >
          <p className="font-medium">Couldn’t load your repositories.</p>
          <p className="mt-1 text-accent-failure">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center rounded border border-accent-failure px-3 py-1 text-sm font-medium text-accent-failure hover:bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-failure"
            >
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const showSkeleton = loading && repos.length === 0;
  const isEmpty = !showSkeleton && repos.length === 0;
  const statusMessage = loading
    ? 'Loading repositories…'
    : `${model.total} ${model.total === 1 ? 'repository' : 'repositories'}`;

  // Healthy is rendered as the collapsed tail band; the attention bands precede it.
  const attentionGroups = model.groups.filter((g) => g.band !== 'healthy');
  const healthyGroup = model.groups.find((g) => g.band === 'healthy');

  return (
    <section aria-label="Triage" className="flex flex-col gap-4">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        {statusMessage}
      </p>

      {showSkeleton ? (
        <ul aria-busy="true" aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li
              key={`skeleton-${index}`}
              className="flex items-center gap-3 rounded-md border border-border bg-surface p-3"
            >
              <span className="block h-3 w-48 animate-pulse rounded bg-border motion-reduce:animate-none" />
              <span className="block h-3 w-20 animate-pulse rounded bg-border motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-text-muted">No repositories found for this token.</p>
        </div>
      ) : model.allClear ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface px-4 py-10 text-center">
          <span aria-hidden="true" className="text-2xl text-accent-success">
            ✓
          </span>
          <p className="text-sm text-text-muted">All clear — nothing needs your attention.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {attentionGroups.map((group) => (
            <BandSection
              key={group.band}
              band={group.band}
              repos={group.repos}
              getRowData={getRowData}
              onRepoActivate={onRepoActivate}
            />
          ))}
          {healthyGroup ? (
            <HealthyBand
              repos={healthyGroup.repos}
              getRowData={getRowData}
              onRepoActivate={onRepoActivate}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
