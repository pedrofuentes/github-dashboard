/**
 * Built-in Saved View presets — read-only starter workspaces that make the
 * Saved Views menu useful out of the box (e3). Each preset composes a fresh,
 * single-facet {@link RepoFilterQueryV2} with a sensible target {@link FleetView},
 * mirroring the ⌘K filter commands (needs attention, awaiting review, failing CI,
 * security risk, stale) plus an "all repositories" reset.
 *
 * Presets are pure data: stable `preset:`-prefixed ids and a constant epoch
 * `createdAt`, so they validate against {@link SavedViewSchema} yet never collide
 * with the user's persisted views. The parent applies a preset exactly like a
 * saved view (restore filter + view); presets are never renamed or deleted.
 */
import { type RepoFilterQueryV2 } from './repo-filter-query';
import type { SavedView } from './saved-views';
import type { FleetView } from './view-preference';

/** The constant `createdAt` stamped on every preset (the Unix epoch). */
const PRESET_CREATED_AT = '1970-01-01T00:00:00.000Z';

/** The `id` prefix marking a {@link SavedView} as a built-in preset. */
const PRESET_ID_PREFIX = 'preset:';

/** Whether the given id belongs to a built-in preset (vs. a user-saved view). */
export function isPresetId(id: string): boolean {
  return id.startsWith(PRESET_ID_PREFIX);
}

/** Builds a fresh empty query so presets never share mutable facet state. */
function emptyFilter(): RepoFilterQueryV2 {
  return {
    version: 2,
    text: '',
    repoSelection: { mode: 'all', names: [] },
    facets: {
      owners: [],
      health: [],
      ci: [],
      security: { grades: [], severities: [] },
      pullRequests: [],
      reviews: [],
      issues: [],
      stale: [],
      visibility: [],
    },
  };
}

/** Builds a preset from a one-facet mutation of a fresh empty query. */
function preset(
  id: string,
  name: string,
  view: FleetView,
  mutate: (filter: RepoFilterQueryV2) => void,
): SavedView {
  const filter = emptyFilter();
  mutate(filter);
  return { id, name, view, filter, createdAt: PRESET_CREATED_AT };
}

/**
 * Builds the read-only starter views. Returns a fresh array of fresh objects on
 * every call (no shared mutable state). Every preset except `preset:all-repos`
 * narrows the fleet (`isQueryActive` is true); `all-repos` is a reset to fleet.
 */
export function buildViewPresets(): SavedView[] {
  return [
    preset('preset:needs-attention', 'Needs attention', 'triage', (filter) => {
      filter.facets.health = ['broken'];
    }),
    preset('preset:awaiting-review', 'Awaiting my review', 'triage', (filter) => {
      filter.facets.reviews = ['awaiting-me'];
    }),
    preset('preset:failing-ci', 'Failing CI', 'matrix', (filter) => {
      filter.facets.ci = ['failure'];
    }),
    preset('preset:security-risk', 'Security risk', 'matrix', (filter) => {
      filter.facets.security = { ...filter.facets.security, maxGrade: 'C' };
    }),
    preset('preset:stale', 'Stale', 'grid', (filter) => {
      filter.facets.stale = ['any'];
    }),
    preset('preset:all-repos', 'All repositories', 'matrix', () => {
      // Intentionally no facet: a reset-to-fleet view.
    }),
  ];
}
