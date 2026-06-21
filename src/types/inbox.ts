/**
 * Inbox item model (DESIGN-INBOX §2.1).
 *
 * Type-only module — like `src/types/fleet.ts` it intentionally emits no JS so
 * it stays outside coverage accounting. Runtime behaviour (the §2.2 stable-ID
 * grammar) lives in `src/lib/inbox/ids.ts`.
 */
import type { AccentTone } from '../components/tiles/types';
import type { Repo } from './fleet';

/** The five actionable signal kinds the Inbox surfaces (§1). */
export type InboxKind = 'ci' | 'review' | 'new-pr' | 'security' | 'stale';

/** Security-alert severity, used as the accent driver for `security` items (§5). */
export type InboxSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A single actionable Inbox entry derived from one underlying fleet event. */
export interface InboxItem {
  /** Stable, deterministic id (see §2.2). Survives re-derivation. */
  id: string;
  kind: InboxKind;
  /** The repository the event belongs to. */
  repo: Repo;
  /** Human-readable, e.g. "CI failing — build.yml" or the PR/issue/alert title. */
  title: string;
  /** GitHub deep link; only rendered as href when `safeGitHubHref` accepts it. */
  url: string;
  /** ISO 8601 instant used for newest-first ordering and the watermark. */
  timestamp: string;
  /** Present for security alerts (drives the accent); omitted otherwise. */
  severity?: InboxSeverity;
  /** Precomputed semantic accent token (see §5). */
  accent: AccentTone;
}
