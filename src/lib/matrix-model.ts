/**
 * Pure data model for the Fleet Matrix (ADR-026).
 *
 * Framework-free projection + sort + grouping logic that transforms a fleet
 * list into the dense repos×signals matrix. Reuses existing {@link classifyRepoHealth}
 * for per-repo health bands. The matrix COMPONENT (c2) is a later task — this
 * module provides only the data transformation.
 */
import type { Repo, GetRowData } from '../types/fleet';
import type { TileSignalType } from '../types/dashboard';
import { classifyRepoHealth, type RepoHealth } from './fleet-summary';

/** The 7 signal columns in sensible display order. */
export const MATRIX_SIGNALS: readonly TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
  'activity',
] as const;

/** A single matrix row = repo + its classified health. */
export interface MatrixRow {
  repo: Repo;
  health: RepoHealth;
}

/** A health-grouped section of rows, worst-first ordered. */
export interface MatrixGroup {
  health: RepoHealth;
  rows: MatrixRow[];
}

/** The complete matrix model: ordered rows, health groups, signals, counts. */
export interface MatrixModel {
  /** All repos sorted worst-first (broken → warning → healthy), stable within band. */
  rows: MatrixRow[];
  /** Health-grouped rows in worst-first order; omits groups with zero rows. */
  groups: MatrixGroup[];
  /** The signal column types (= MATRIX_SIGNALS). */
  signals: readonly TileSignalType[];
  /** Per-health and total counts. */
  counts: {
    broken: number;
    warning: number;
    healthy: number;
    total: number;
  };
}

/** Health band ordering: broken = 0, warning = 1, healthy = 2 (worst-first). */
const HEALTH_ORDER: Record<RepoHealth, number> = {
  broken: 0,
  warning: 1,
  healthy: 2,
};

/**
 * Comparator for worst-first health ordering (broken < warning < healthy).
 * Returns < 0 if a is worse, > 0 if b is worse, 0 if equal.
 */
export function compareRepoHealth(a: RepoHealth, b: RepoHealth): number {
  return HEALTH_ORDER[a] - HEALTH_ORDER[b];
}

/**
 * Groups rows by health in worst-first order. Omits groups with zero rows.
 * Preserves row order within each group.
 */
export function groupRowsByHealth(rows: MatrixRow[]): MatrixGroup[] {
  const groups: MatrixGroup[] = [
    { health: 'broken', rows: [] },
    { health: 'warning', rows: [] },
    { health: 'healthy', rows: [] },
  ];

  for (const row of rows) {
    groups[HEALTH_ORDER[row.health]].rows.push(row);
  }

  return groups.filter((g) => g.rows.length > 0);
}

/**
 * Builds the complete matrix model from a fleet list.
 * - Rows are sorted worst-first (broken → warning → healthy), stable within band.
 * - Groups are health-bucketed, worst-first, omitting empty groups.
 * - Pure: no mutation of inputs.
 */
export function buildMatrixModel(repos: Repo[], getRowData: GetRowData): MatrixModel {
  const rows: MatrixRow[] = repos.map((repo) => ({
    repo,
    health: classifyRepoHealth(getRowData(repo)),
  }));

  rows.sort((a, b) => compareRepoHealth(a.health, b.health));

  const groups = groupRowsByHealth(rows);

  const counts = {
    broken: 0,
    warning: 0,
    healthy: 0,
    total: rows.length,
  };

  for (const row of rows) {
    counts[row.health] += 1;
  }

  return {
    rows,
    groups,
    signals: MATRIX_SIGNALS,
    counts,
  };
}
