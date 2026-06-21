/**
 * Pure hero-metric summariser (DESIGN-TILES §5, §8; redesign R1).
 *
 * Produces the short scope+metric phrase a tile's accessible name embeds, e.g.
 * `"2 failing"`, `"3 awaiting review"`, `"oldest 34d"`. It is the single source
 * of truth for the metric text in both `SignalTile`'s `accessibleSummary` and
 * each redesigned body, so the visible hero and the screen-reader label never
 * drift.
 *
 * It reads only fields already on each signal slice (no new data, no I/O) and is
 * deterministic given an explicit `now`. **Activity has no `RepoSignalData`
 * slice** — it is fetched inside `ActivityTileBody` via `useCommitActivity` — so
 * the frame can only contribute a scope+state phrase (`"recent activity"`); the
 * Activity body owns its own live hero announcement for the real metric.
 */
import type { TileSignalType } from '../types/dashboard';
import type { RepoSignalData, SignalStatus } from '../types/fleet';

const DAY_MS = 86_400_000;

function stateSummary(status: SignalStatus | undefined): string {
  switch (status) {
    case 'loading':
      return 'loading';
    case 'error':
      return 'unavailable';
    default:
      return 'no data';
  }
}

function oldestAgeDays(items: { updated_at: string }[], now: number): number {
  let oldest = -1;
  for (const item of items) {
    const parsed = Date.parse(item.updated_at);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const days = Math.floor((now - parsed) / DAY_MS);
    if (days > oldest) {
      oldest = days;
    }
  }
  return oldest;
}

/**
 * Summarise the hero metric for a (signal, data) pairing. Returns a short phrase
 * for `ready` slices and a neutral state phrase (`loading`/`unavailable`/`no
 * data`) otherwise. Activity always returns a scope+state phrase.
 */
export function signalHeroSummary(
  signal: TileSignalType,
  data: RepoSignalData,
  now: number = Date.now(),
): string {
  if (signal === 'activity') {
    return 'recent activity';
  }

  const slice = data[signal];
  if (!slice || slice.status !== 'ready') {
    return stateSummary(slice?.status);
  }

  switch (signal) {
    case 'ci': {
      const ci = data.ci;
      const failing = ci?.failingCount ?? (ci?.conclusion === 'failure' ? 1 : 0);
      return `${failing} failing`;
    }
    case 'security': {
      const counts = data.security?.counts;
      if (!counts) {
        return '0 alerts';
      }
      if (counts.critical > 0) {
        return `${counts.critical} critical`;
      }
      const total = counts.critical + counts.high + counts.medium + counts.low;
      return `${total} ${total === 1 ? 'alert' : 'alerts'}`;
    }
    case 'reviews':
      return `${data.reviews?.requestedCount ?? 0} awaiting review`;
    case 'pullRequests':
      return `${data.pullRequests?.openCount ?? 0} open`;
    case 'issues':
      return `${data.issues?.openCount ?? 0} open`;
    case 'stale': {
      const stale = data.stale;
      const oldest = oldestAgeDays(stale?.staleItems ?? [], now);
      if (oldest >= 0) {
        return `oldest ${oldest}d`;
      }
      return `${stale?.staleCount ?? 0} stale`;
    }
  }
}
