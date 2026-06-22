/**
 * Stable, deterministic Inbox item IDs — the single source of truth for the
 * §2.2 grammar (DESIGN-INBOX). IDs survive re-derivation on every fleet refresh
 * so triage state (read/dismissed) sticks to the same underlying event: the
 * same event always hashes to the same id.
 *
 * One builder per kind plus `parseInboxId` and the `isInboxId` guard, so
 * producers and the triage store agree on one grammar and ids are validated
 * (never hand-concatenated) at every call site (§2.2). `<repo>` is the
 * `nameWithOwner` (`owner/name`); GitHub repo, owner, run, PR, issue and alert
 * identifiers contain none of the `:` / `#` separators, so no escaping is
 * required.
 */

/** Security-alert feed an id points at (§1.4). */
export type SecurityAlertType = 'dependabot' | 'code-scanning';

/** Whether a stale id points at a pull request or an issue (§1.5). */
export type StaleTarget = 'pr' | 'issue';

/** Structured result of {@link parseInboxId}; mirrors each builder's inputs. */
export type ParsedInboxId =
  | { kind: 'ci'; repo: string; runId: string }
  | { kind: 'review'; repo: string; prNumber: number }
  | { kind: 'new-pr'; repo: string; prNumber: number }
  | { kind: 'security'; repo: string; type: SecurityAlertType; alertNumber: number }
  | { kind: 'stale'; repo: string; target: StaleTarget; itemNumber: number };

// `owner/name`: exactly one `/`, with neither segment containing a `:` / `#`
// separator (nor a second `/`).
const REPO = '[^:#/]+/[^:#/]+';

const CI_RE = new RegExp(`^ci:(${REPO}):([0-9]+)$`);
const REVIEW_RE = new RegExp(`^review:(${REPO}):#([0-9]+)$`);
const NEW_PR_RE = new RegExp(`^new-pr:(${REPO}):#([0-9]+)$`);
const SECURITY_RE = new RegExp(`^security:(${REPO}):(dependabot|code-scanning):([0-9]+)$`);
const STALE_RE = new RegExp(`^stale:(${REPO}):(pr|issue):#([0-9]+)$`);

const REPO_RE = /^[^:#/]+\/[^:#/]+$/;

/** Allowed enum segments per the §1.4/§1.5 grammars (internal discriminators). */
const SECURITY_ALERT_TYPES: readonly SecurityAlertType[] = ['dependabot', 'code-scanning'];
const STALE_TARGETS: readonly StaleTarget[] = ['pr', 'issue'];

function assertRepo(repo: string): void {
  if (!REPO_RE.test(repo)) {
    throw new Error(`Invalid inbox-id repo: ${JSON.stringify(repo)} (expected "owner/name")`);
  }
}

/**
 * Belt-and-suspenders guard for the string-literal enum segments. They are
 * compile-time unions, but asserting them keeps an internal mis-call from
 * interpolating an off-grammar value into an id.
 */
function assertEnum(label: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid inbox-id ${label}: ${JSON.stringify(value)} (expected one of ${allowed.join(', ')})`,
    );
  }
}

function numericSegment(label: string, value: number | string): string {
  if (typeof value === 'number') {
    // A safe integer is required: `String(1e21) === '1e+21'` (and any value
    // above 2^53−1) would not round-trip through the digit grammar (#226).
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid inbox-id ${label}: ${value} (expected a non-negative safe integer)`);
    }
    return String(value);
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`Invalid inbox-id ${label}: ${JSON.stringify(value)} (expected digits)`);
  }
  return value;
}

/** `ci:<repo>:<run-id>` — failing-CI run (§1.1). */
export function buildCiId(repo: string, runId: number | string): string {
  assertRepo(repo);
  return `ci:${repo}:${numericSegment('run id', runId)}`;
}

/** `review:<repo>:#<pr-number>` — PR awaiting the user's review (§1.2). */
export function buildReviewId(repo: string, prNumber: number): string {
  assertRepo(repo);
  return `review:${repo}:#${numericSegment('pr number', prNumber)}`;
}

/** `new-pr:<repo>:#<pr-number>` — new outside-contributor PR (§1.3). */
export function buildNewPrId(repo: string, prNumber: number): string {
  assertRepo(repo);
  return `new-pr:${repo}:#${numericSegment('pr number', prNumber)}`;
}

/** `security:<repo>:<type>:<alert-number>` — open security alert (§1.4). */
export function buildSecurityId(
  repo: string,
  type: SecurityAlertType,
  alertNumber: number,
): string {
  assertRepo(repo);
  assertEnum('security type', type, SECURITY_ALERT_TYPES);
  return `security:${repo}:${type}:${numericSegment('alert number', alertNumber)}`;
}

/** `stale:<repo>:<pr|issue>:#<number>` — stale PR or issue (§1.5). */
export function buildStaleId(repo: string, target: StaleTarget, itemNumber: number): string {
  assertRepo(repo);
  assertEnum('stale target', target, STALE_TARGETS);
  return `stale:${repo}:${target}:#${numericSegment('item number', itemNumber)}`;
}

/**
 * Parses an id back into its components, or `null` when `id` does not match the
 * §2.2 grammar. The leading kind literal makes the five grammars mutually
 * exclusive, so an id resolves to at most one kind.
 */
export function parseInboxId(id: string): ParsedInboxId | null {
  const ci = CI_RE.exec(id);
  if (ci) {
    return { kind: 'ci', repo: ci[1], runId: ci[2] };
  }
  const review = REVIEW_RE.exec(id);
  if (review) {
    return { kind: 'review', repo: review[1], prNumber: Number(review[2]) };
  }
  const newPr = NEW_PR_RE.exec(id);
  if (newPr) {
    return { kind: 'new-pr', repo: newPr[1], prNumber: Number(newPr[2]) };
  }
  const security = SECURITY_RE.exec(id);
  if (security) {
    return {
      kind: 'security',
      repo: security[1],
      type: security[2] as SecurityAlertType,
      alertNumber: Number(security[3]),
    };
  }
  const stale = STALE_RE.exec(id);
  if (stale) {
    return {
      kind: 'stale',
      repo: stale[1],
      target: stale[2] as StaleTarget,
      itemNumber: Number(stale[3]),
    };
  }
  return null;
}

/** Type guard: `true` only for a string that matches the §2.2 grammar. */
export function isInboxId(value: unknown): value is string {
  return typeof value === 'string' && parseInboxId(value) !== null;
}
