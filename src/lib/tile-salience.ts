/**
 * Pure salience resolver (DESIGN-TILES §3 + §5).
 *
 * Maps a (signal, data) pairing to the visual salience treatment a tile's edge
 * should carry, implementing the 3-tier model:
 *
 * - **PROBLEM** — something is broken right now (failing CI, open security
 *   alerts): a coloured edge plus a tinted surface and soft glow.
 * - **ACTIONABLE** — something awaits *you* (review requests): an info-blue
 *   persistent edge tab, but no tint/glow.
 * - **CALM** — informational only: a neutral edge; identity colour lives in the
 *   header icon, not the edge.
 *
 * The resolver reads only fields already present on each signal slice (no new
 * data, no I/O) and escalates only `status === 'ready'` slices.
 */
import type { AccentTone } from '../components/tiles/types';
import type { TileSignalType } from '../types/dashboard';
import type { RepoSignalData } from '../types/fleet';

/** The three salience tiers a tile can occupy (DESIGN-TILES §3). */
export type SalienceTier = 'problem' | 'actionable' | 'calm';

/** Visual salience treatment for a tile's edge/surface. */
export interface TileSalience {
  tier: SalienceTier;
  /** Bar/edge colour; `neutral` for calm. */
  edgeTone: AccentTone;
  /** Accent-tinted surface — problem only. */
  tint: boolean;
  /** Soft glow — problem only. */
  glow: boolean;
  /** Info-blue persistent edge tab — actionable only. */
  actionableTab: boolean;
}

const CALM: TileSalience = {
  tier: 'calm',
  edgeTone: 'neutral',
  tint: false,
  glow: false,
  actionableTab: false,
};

function problem(edgeTone: AccentTone): TileSalience {
  return { tier: 'problem', edgeTone, tint: true, glow: true, actionableTab: false };
}

const ACTIONABLE: TileSalience = {
  tier: 'actionable',
  edgeTone: 'info',
  tint: false,
  glow: false,
  actionableTab: true,
};

/**
 * Resolve the salience treatment for a tile. Only `ready` slices escalate;
 * `loading`/`error`/`unknown`/absent slices resolve to calm.
 */
export function resolveSalience(signal: TileSignalType, data: RepoSignalData): TileSalience {
  switch (signal) {
    case 'ci': {
      const ci = data.ci;
      if (ci?.status === 'ready' && ci.conclusion === 'failure') {
        return problem('failure');
      }
      return CALM;
    }
    case 'security': {
      const security = data.security;
      if (security?.status === 'ready' && security.counts) {
        const { critical, high, medium } = security.counts;
        if (critical > 0) {
          return problem('failure');
        }
        if (high > 0 || medium > 0) {
          return problem('warning');
        }
      }
      return CALM;
    }
    case 'reviews': {
      const reviews = data.reviews;
      if (reviews?.status === 'ready' && (reviews.requestedCount ?? 0) > 0) {
        return ACTIONABLE;
      }
      return CALM;
    }
    case 'pullRequests':
    case 'issues':
    case 'stale':
    case 'activity':
      return CALM;
  }
}
