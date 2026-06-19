/**
 * Shared GitHub domain types.
 *
 * Type-only re-exports of the data shapes returned by the `src/api/github`
 * REST layer, giving hooks and components a single import surface for GitHub
 * domain models without pulling in the runtime client code.
 */

export type { RateLimitInfo } from '../api/github/core';
export type { RepoStats, StatType, NumericStatType } from '../api/github/repos';
export type { ReviewRequestedPR } from '../api/github/pull-requests';
export type { ReleaseInfo } from '../api/github/issues-releases';
export type {
  WorkflowRun,
  WorkflowInfo,
  DeploymentStatus,
  WorkflowRunStatus,
  WorkflowRunConclusion,
  DeploymentState,
} from '../api/github/workflows';
export type {
  AlertSeverity,
  SecurityAlertSummary,
  BranchComparison,
  BranchInfo,
  CommitActivityWeek,
  NetworkGraphCommit,
  NetworkGraphTag,
} from '../api/github/security-branches';
export type { DataSourceItem } from '../api/github/datasources';
