/**
 * Shared types for the Fleet overview grid.
 *
 * This module is intentionally free of runtime values so it emits no JS and
 * stays outside coverage accounting — keep it that way (helpers with behavior
 * belong in `src/lib/fleet-sort.ts`).
 */
import type { ReactNode } from 'react';

/** A single repository anchored by its `owner/repo` full name. */
export interface Repo {
  /** `owner/repo`, e.g. `octocat/hello-world`. */
  nameWithOwner: string;
  /** The owner login, e.g. `octocat`. */
  owner: string;
  /** The bare repository name, e.g. `hello-world`. */
  name: string;
  /** Whether the repository is private (surfaced non-visually for a11y). */
  isPrivate: boolean;
}

/** Lifecycle of a per-repo signal cell (features #12-18 populate these). */
export type SignalStatus = 'unknown' | 'loading' | 'ready' | 'error';

/**
 * Base shape every signal column shares. Signal features extend the registry
 * by reading their own slice from {@link RepoSignalData}; `score` feeds the
 * future composite "most broken" sort.
 */
export interface SignalSlice {
  status: SignalStatus;
  /** Higher = more attention needed; contributes to sort ordering. */
  score?: number;
}

/**
 * Per-repo signal payload. Each optional slot is owned by one signal feature
 * (issues #12-18); the grid framework ships them all empty.
 */
export interface RepoSignalData {
  ci?: SignalSlice;
  security?: SignalSlice;
  reviews?: SignalSlice;
  pullRequests?: SignalSlice;
  issues?: SignalSlice;
  stale?: SignalSlice;
}

/** Resolves the signal payload for a repo (defaults to empty in the framework). */
export type GetRowData = (repo: Repo) => RepoSignalData;

/** Sortable values are compared as numbers or case-insensitively as strings. */
export type SortValue = string | number;

/** Sort direction for a column. */
export type SortDirection = 'asc' | 'desc';

/** The active sort: which column and in which direction. */
export interface FleetSortState {
  columnId: string;
  direction: SortDirection;
}

/**
 * A registry column descriptor. One column = one file under
 * `src/components/columns/`; see `columns/index.ts` for the extension pattern.
 */
export interface FleetColumn {
  /** Stable id used for sort persistence and registry ordering. */
  id: string;
  /** Visible, human-readable column header. */
  header: string;
  /** Marks the column whose cell is the row's `<th scope="row">` anchor. */
  isRowHeader?: boolean;
  /** Whether the header is a click/Enter/Space sortable control. */
  sortable?: boolean;
  /** Preferred direction applied the first time a column becomes active. */
  defaultSortDirection?: SortDirection;
  /** Horizontal alignment of the cell content. */
  align?: 'start' | 'center' | 'end';
  /** Produces the value used to sort by this column (defaults to repo name). */
  getSortValue?: (repo: Repo, data: RepoSignalData) => SortValue;
  /** Renders the cell body for a repo row. */
  render: (repo: Repo, data: RepoSignalData) => ReactNode;
}
