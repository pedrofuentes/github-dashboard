# DESIGN-INBOX — Notifications Inbox Design Spec

> **Status:** Contract / source of truth. The "Notifications Inbox" milestone
> (`ROADMAP.md` M11) builds from this document. Every downstream PR — the item
> model, the derivation, the triage store, the hook, the view, the toggle
> wiring — implements a section here.
> **Scope:** the third top-level `FleetView` (`'inbox'`): a single triageable,
> newest-first list of everything across the fleet that needs the user's
> attention. This doc specifies the signal→item mapping, the item model + stable
> ID grammar, the client-side triage state model (localStorage + Zod, capped and
> pruned), sort/filter behavior, the severity→accent token mapping, the
> a11y/state requirements, the module breakdown, and the increment plan. It
> specifies; it changes **no code**. Each section names the downstream increment
> (§8) that implements it.

## 0. Why this exists

The fleet already answers _"what is the state of each repo?"_ — the table view
(`FleetGrid`) renders one row per repo with a cell per signal, and the dashboard
view (`DashboardView`) renders one tile per (repo, signal). Both are
**repo-major aggregates**: to find _"what needs me right now,"_ a maintainer has
to scan every repo and every cell, read counts, and click through to the items
behind them. A failing build on one repo and a first-time-contributor PR on
another are equally easy to miss because nothing collects the discrete,
actionable events into one place ordered by recency.

The **Inbox** is that place: a flat, **newest-first** queue of the individual
events that warrant attention, with per-item triage (read, dismiss, "new since
last visit") that survives refreshes. Crucially, it is a **pure transform of
data the app already fetches** for the table/dashboard views — it adds **no new
GitHub token permission, no new API request or datasource, no new
network/privacy surface, and never writes back to GitHub** (the PAT is
fine-grained read-only; §9). It is the post-MVP "notifications inbox" listed in
`MISSION.md` §4 and `ROADMAP.md` "Out of scope," promoted to a milestone after a
live design session with the cofounder.

### Context (do not re-derive — taken from current source)

| Fact | Value | Source |
| --- | --- | --- |
| Fleet view union | `'grid' \| 'dashboard'` (Inbox adds `'inbox'`) | `src/lib/view-preference.ts` `FleetView` |
| View persistence key | `fleet:default-view` (localStorage, default `'dashboard'`) | `src/lib/default-view-preference.ts` |
| Row-data seam | `getRowData(repo): RepoSignalData` | `src/hooks/useRepoSignals.ts`; `src/types/fleet.ts` `GetRowData` |
| Per-repo signal payload | `{ ci?, security?, reviews?, pullRequests?, issues?, stale? }` | `src/types/fleet.ts` `RepoSignalData` |
| Signal lifecycle | `'unknown' \| 'loading' \| 'ready' \| 'error'` | `src/types/fleet.ts` `SignalStatus` |
| URL safety | `safeGitHubHref` / `isGitHubUrl` (https + `*.github.com` only) | `src/lib/github-url.ts` |
| Defensive persistence pattern | `safeGet`/`safeSet`, Zod `safeParse` → default, reconcile-against-present, `.max()` caps | `src/lib/dashboard-layout.ts`, `src/lib/fleet-preferences.ts` |
| Design tokens (accents) | `accent-failure/-warning/-info/-neutral/-coral` (CSS-var backed, AA both themes) | `docs/DESIGN-TILES.md` §1.3–§1.5 |
| Stale threshold | `STALE_THRESHOLD_DAYS = 30` | `src/hooks/signals/useStaleSignal.ts` |

The Inbox **reuses the existing `getRowData` seam unchanged** as a composition
point — it derives from the same per-repo slices the grid and dashboard already
consume. It introduces no new fetch path.

---

## 1. Signals → items

The Inbox surfaces **exactly five** actionable kinds. Each maps to a discrete
event that already flows through a signal feature. Counts and trends are
**not** items: the commit-activity sparkline (`ActivitySignalSlice`) and raw
open issue/PR _counts_ (`IssuesSignalSlice.openCount`,
`PullRequestsSignalSlice.openCount`) are aggregate context, not discrete events,
and never become Inbox items. Only the five below do.

Each mapping below lists: **kind**, the **signal source** (endpoint + module),
the **fields already fetched**, the **minimal pure-derivation** needed to expose
per-item identity (always from data already in-flight — **no new request,
datasource, or token permission**), the **timestamp** used for ordering, and the
**stable ID** (§2).

**One PR can surface under more than one kind — by design.** A PR opened by a new
outside contributor that *also* requests your review qualifies as **both** `new-pr`
and `review`, and it is emitted as **two distinct items** — **not** deduped. The two
carry different stable IDs (`new-pr:<repo>:#<n>` vs `review:<repo>:#<n>`, §2.2),
different accents (§5), and **independent triage**: dismissing the review task leaves
the "new contributor" flag standing, and vice-versa. Collapsing them would drop a
real, separately-actionable signal, so the Inbox intentionally shows such a PR once
per qualifying kind; the §2.2 grammar guarantees the two ids never collide.

### 1.1 Failing CI — `kind: 'ci'`

- **Signal source:** `CiSignalSlice` from `useCiSignal` —
  `GET /repos/{owner}/{repo}/actions/runs?per_page=1` (`runsUrl`,
  `src/hooks/signals/useCiSignal.ts`).
- **Already fetched:** the slice carries `conclusion` (`'failure'` when the
  latest run is broken — `FAILING_CONCLUSIONS` = `failure`/`timed_out`/
  `startup_failure`), `failingCount`, and `latestRunUrl` (the run's `html_url`,
  e.g. `…/actions/runs/<run-id>`). The same `?per_page=1` response also carries
  the run's `id` and `updated_at`, which `CiRunSchema` currently drops.
- **Minimal pure-derivation (no new request):** widen `CiRunSchema` to keep the
  already-present `id` and `updated_at`, and surface them on `CiSignalSlice`
  (e.g. `runId`, `updatedAt`). The run-id can equivalently be parsed from the
  trailing path segment of `latestRunUrl`. An item is emitted only when
  `conclusion === 'failure'`.
- **Timestamp:** run `updated_at` (when the failing run concluded).
- **ID:** `ci:<repo>:<run-id>`.

### 1.2 PRs awaiting the user's review — `kind: 'review'`

- **Signal source:** `ReviewsSignalSlice` from `useReviewsSignal` — one
  cross-repo Search call `is:open is:pr review-requested:@me`
  (`reviewRequestedSearchUrl`, paginated via `fetchReviewRequestedPage`,
  `src/hooks/signals/useReviewsSignal.ts`).
- **Already fetched:** each Search item already carries `repository_url`
  (used today only to attribute a count per repo). The full per-PR identity —
  `number`, `title`, `html_url`, `created_at`, `user.login` — is **already
  modeled and parsed in the same module**: `fetchReviewRequestedPage` validates each
  page item through `ReviewRequestedSearchPageSchema` (`pull-requests.ts:~194`),
  whose items use `.passthrough()`, so every Search field survives validation
  **request-free**; `ReviewRequestedPR` (`pull-requests.ts:~22`) already models the
  target shape. The count-only reader then projects it away in the `.map(...)` at
  `pull-requests.ts:~254`
  (`items.map((i) => ({ repository_url: i.repository_url }))`).
- **Minimal pure-derivation (no new request):** have the review-requested page
  reader retain the per-PR fields it already receives (the `ReviewRequestedPR`
  shape) instead of projecting to `repository_url` only, and attribute each PR to
  its repo via `repoFullNameFromUrl`. Same Search pages, same page cap
  (`MAX_REVIEW_PAGES`).
- **Timestamp:** PR `created_at` (a fixed per-PR instant; stable across
  refreshes).
- **ID:** `review:<repo>:#<pr-number>`.

### 1.3 New outside-contributor PRs — `kind: 'new-pr'`

- **Signal source:** `PullRequestsSignalSlice` from `usePullRequestsSignal` —
  `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100`
  (`src/hooks/signals/usePullRequestsSignal.ts`).
- **Already fetched:** `OpenPullRequestSchema` captures `number`, `user.login`,
  `author_association`, `draft`, `html_url`, and `.passthrough()` keeps `title`
  and `created_at`. The "new outside contributor" predicate already exists in
  `summarize`: non-draft **and** `author_association ∈
  OUTSIDE_CONTRIBUTOR_ASSOCIATIONS` (`FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`,
  `NONE`, `MANNEQUIN`).
- **Minimal pure-derivation (no new request):** expose the already-filtered
  external-PR list (add `title` + `created_at` to the typed schema; both are
  already in the payload) on `PullRequestsSignalSlice`. Same per-repo `/pulls`
  response.
- **Timestamp:** PR `created_at` (when the PR was opened).
- **ID:** `new-pr:<repo>:#<pr-number>`.

### 1.4 New security alerts — `kind: 'security'`

- **Signal source:** `SecuritySignalSlice` from `useSecuritySignal` — two feeds
  per repo, `fetchDependabotAlerts` + `fetchCodeScanningAlerts`
  (`src/api/github/security-branches.ts`). **Security is the one signal that does
  NOT ride `fetchWithETag`:** both feeds page through the bespoke `readAlertFeed`
  reader (`security-branches.ts:~182`), which keeps its **own** conditional-request
  cache — the crux of the defect below.
- **Already fetched:** both feeds **page the full open-alert list** and then
  reduce it to severity counts (`SecurityAlertSummary` =
  `{critical, high, medium, low, total, truncated}`). Each raw alert is already
  parsed: `DependabotAlertSchema` (`security_advisory.severity` + `.passthrough()`
  carrying `number`, `html_url`, `created_at`) and `CodeScanningAlertSchema`
  (`rule.severity` / `rule.security_severity_level` + passthrough `number`,
  `html_url`, `created_at`). Per-alert severity bucketing already exists
  (`AlertSeverity`, `codeScanningSeverity`).
- **Why the naive derivation is DISPROVEN on the 304 path:** `readAlertFeed` caches
  **only the `SecurityAlertSummary` counts** (`security-branches.ts:~250`), and on a
  `304 Not Modified` it returns `{ hit: true, summary }` **without any per-alert
  rows** (`~206-207`); `fetchDependabotAlerts` / `fetchCodeScanningAlerts` then
  `return read.summary` and **skip the per-alert loop entirely** on that cache hit
  (`~295`, `~401`). So "retain the rows as the feed iterates them" yields rows **only
  on a fresh `200`** — and the app's refresh cycle settles into `304`s after the
  first load (`useRepoSignals` re-runs every signal's conditional fetch on each
  revalidation, `src/hooks/useRepoSignals.ts:~41-54`). A literal version of that
  derivation would therefore emit **zero security items on every `304`**: security
  items would appear on first load and **vanish on every refresh**, violating the
  §2.3 determinism rule and AC-7 stability. The trap: the request-count AC (AC-5)
  stays **green** throughout, so a test written only against §1's "no new request"
  promise would not catch it.
- **Minimal pure-derivation (no new request) — the REAL enrichment:** extend
  `readAlertFeed`'s bespoke cache to **persist the per-alert rows** (`{ number,
  type: 'dependabot' | 'code-scanning', severity, html_url, created_at }`)
  **alongside** the `SecurityAlertSummary`, and **replay those cached rows on a
  `304`** — exactly mirroring how `fetchWithETag` replays the full parsed body from
  cache on a `304` (`src/api/github/etag-cache.ts:~316`; the body is stored on the
  `200` at `~334`). This stays **zero new requests**: it caches *more of the body the
  `200` already returned*, issuing nothing extra. Concrete touch points — the
  `readAlertFeed` cache shape and its `cache.set` (`security-branches.ts:~250`) widen
  to store the rows; the `304` return path (`~206-207`) returns them; the
  `AlertFeedRead` `hit: true` variant (`~130`) carries them; and the
  `SecuritySignalSlice` (`src/types/fleet.ts:~51-60`) gains an **optional per-alert
  list**. Same alert pages, same `MAX_ALERT_PAGES` cap; `truncated` still flags a
  lower-bound feed — and because a truncated read must never seed a `304`, its rows
  are likewise never replayed. Stability across the `200`→`304` transition is pinned
  by AC-17 (§8).
- **Timestamp:** alert `created_at`.
- **ID:** `security:<repo>:<type>:<alert-number>` where `<type>` ∈
  {`dependabot`, `code-scanning`}.

### 1.5 Stale PRs/issues — `kind: 'stale'`

- **Signal source:** `StaleSignalSlice` from `useStaleSignal` — one Search call
  per repo, `repo:{owner}/{name} is:open updated:<{cutoff}` with `per_page=1`,
  reading only `total_count` (`staleSearchUrl`, `StaleCountSchema`,
  `src/hooks/signals/useStaleSignal.ts`). `cutoff = staleCutoffDate(now)` =
  `STALE_THRESHOLD_DAYS` (30) ago.
- **Already fetched:** **only the count** — this is the one signal that does not
  currently fetch per-item identity (`per_page=1`, count-only schema).
- **Minimal pure-derivation (no new request, no new datasource):** the same
  Search query already returns the matching items; raise its `per_page` from
  `1` to a small bounded page (`STALE_ITEMS_PER_REPO`, e.g. ≤ 30, newest-stale
  first via `sort=updated&order=desc`) and parse `items[]` for `number`,
  `title`, `html_url`, `updated_at`, and `pull_request` (present ⇒ PR, absent ⇒
  issue). This is the **same request to the same endpoint** — the call gains
  both a larger `per_page` and `sort=updated&order=desc` (the current
  `staleSearchUrl` sets neither and uses `per_page=1`, `useStaleSignal.ts:~66`), both
  harmless: it stays one ETag-conditional request to `search/issues`, still one call
  per repo; `total_count` continues
  to drive the dashboard/table count. Items beyond the cap are still counted, not
  listed (mirrors the `truncated` lower-bound convention).
- **Timestamp:** item `updated_at` (last activity before going stale).
  **Intentional trade-off:** a stale item is by definition `>30d` past its
  `updated_at`, so in the newest-first list (§4.1) stale items always sort **last**;
  and because "new since last visit" (§3.1) tests `timestamp > lastVisitedAt`, a
  stale item can essentially **never** be "new since last visit" (its instant always
  predates any recent watermark). This is accepted: stale is a background-backlog
  signal, not a fresh-event one, so surfacing it at the bottom and un-highlighted is
  the intended behavior.
- **ID:** `stale:<repo>:<pr|issue>:#<number>`.

### 1.6 Mapping summary

| Kind | Source module | Endpoint (already used) | Per-item identity | Enrichment |
| --- | --- | --- | --- | --- |
| `ci` | `useCiSignal` | `…/actions/runs?per_page=1` | run id + `updated_at` | keep 2 dropped fields |
| `review` | `useReviewsSignal` | Search `review-requested:@me` | `number/title/url/created_at` | un-project (already parsed) |
| `new-pr` | `usePullRequestsSignal` | `…/pulls?state=open` | external-PR list | type 2 passthrough fields |
| `security` | `useSecuritySignal` | Dependabot + code-scanning feeds | per-alert `{number,severity,type}` | **most invasive (the exception)** — persist rows in `readAlertFeed`'s bespoke cache **and replay on 304**, plus the slice list (§1.4) |
| `stale` | `useStaleSignal` | Search `is:open updated:<cutoff` | per-item `{number,type,url}` | widen `per_page` + add `sort`/`order` (same call) |

The **first four rows are request-free retains**: `ci`, `new-pr`, and `stale` ride
`fetchWithETag`, which replays the **full parsed body** from cache on a `304`, and
`review` re-reads a full `200` page every cycle (it is not ETag-short-circuited) — so
their already-parsed per-item rows are present on **every** derivation and the
enrichment is simply "stop discarding fields." **`security` is the exception and the
most invasive enrichment**: its bespoke `readAlertFeed` cache stores **only** the
summary and replays **only** the summary on a `304`, so the rows must be added to
that cache, to its `304` replay path, and to the fleet slice (§1.4). Every
enrichment is still **additive and back-compatible**: existing slice fields and the
existing counts/grades are unchanged; the Inbox reads new optional fields and the
table/dashboard ignore them.

---

## 2. Item model + stable ID grammar

### 2.1 `InboxItem`

```ts
// src/types/inbox.ts (illustrative; the INBOX-1 increment owns the final shape)
export type InboxKind = 'ci' | 'review' | 'new-pr' | 'security' | 'stale';

export type InboxSeverity = 'critical' | 'high' | 'medium' | 'low';

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
  /** Precomputed semantic accent token (see §5), e.g. 'accent-failure'. */
  accent: AccentTone;
}
```

`repo` holds the `Repo` (so the row can render the private-repo affordance for
a11y, mirroring the cells); the ID uses `repo.nameWithOwner`.

### 2.2 Stable ID grammar

IDs are **deterministic** so triage state (read/dismissed) survives
re-derivation on every fleet refresh — the same underlying event always hashes to
the same id. `<repo>` is `owner/name` (`nameWithOwner`); GitHub repo, owner,
run, PR, issue, and alert identifiers contain none of the `:` / `#` separators,
so no escaping is required.

| Kind | Grammar | Example |
| --- | --- | --- |
| `ci` | `ci:<repo>:<run-id>` | `ci:octocat/hello-world:9876543210` |
| `review` | `review:<repo>:#<pr-number>` | `review:octocat/hello-world:#42` |
| `new-pr` | `new-pr:<repo>:#<pr-number>` | `new-pr:octocat/hello-world:#108` |
| `security` | `security:<repo>:<type>:<alert-number>` | `security:octocat/hello-world:dependabot:7` |
| `stale` | `stale:<repo>:<pr\|issue>:#<number>` | `stale:octocat/hello-world:issue:#13` |

`lib/inbox/ids.ts` owns one builder per kind plus a `parseInboxId` and an
`isInboxId` guard, so producers and the triage store agree on a single grammar
and IDs are validated (not hand-concatenated) at every call site.

### 2.3 Determinism rules

- The **timestamp must be a fixed per-event instant** (`created_at` for review/
  new-pr/security; the run/issue/PR `updated_at` for ci/stale) — never
  "now" / "age" — so re-derivation does not reshuffle the list or change ids.
- Derivation is a **pure function** of `(repos, getRowData)`; given the same
  fleet data it returns byte-identical items (same order, same ids).
- A slice in `loading`/`error`/`unknown` contributes **no items** for that
  signal (the Inbox surfaces its load/error state once, globally — §6 — rather
  than per row).

---

## 3. Triage state model

Triage is **full, client-side, and per-device** — it mirrors how theme, view,
and dashboard-layout already persist (`localStorage`, Zod-validated, degrade to
default). It never calls GitHub (§9: no mark-read-on-GitHub).

### 3.1 State

| Concept | Definition |
| --- | --- |
| **read** | `item.id ∈ readIds`. Set when the user clicks the item / opens its URL, or via "mark all read". |
| **unread** | not dismissed **and** `item.id ∉ readIds`. |
| **dismissed / archived** | `item.id ∈ dismissedIds`. Hidden by default; restorable via "show dismissed" (§4). |
| **new since last visit** | `lastVisitedAt !== null && item.timestamp > lastVisitedAt`. A highlight, **independent** of read/unread. On a **null watermark** (first-ever visit — `DEFAULT_TRIAGE`), **nothing** is "new since last visit": the highlight is reserved for items that arrive *after* a recorded visit, so the first load is calm rather than a wall of highlights. INBOX-5 owns this rule. |
| **unread count** | number of currently-derived items that are unread. The badge surfaced on the view toggle (§7). |

`lastVisitedAt` (the **watermark**) is `null` until the first visit; it then advances
to "now" each time the Inbox view is opened (or on an explicit "mark all seen"), so
items that arrived since the last *recorded* visit are highlighted exactly once.
While the watermark is `null`, no item counts as "new since last visit" (INBOX-5).

### 3.2 Persistence schema (localStorage + Zod)

Key `fleet:inbox-triage` (namespaced like `fleet:view`,
`fleet:dashboard-layout`). Mirrors `dashboard-layout.ts`: `safeGet`/`safeSet`,
`safeParse` → on any failure return the default, never throw.

```ts
// src/lib/inbox/triage-store.ts (illustrative; INBOX-4 owns the final values)
export const MAX_TRIAGE_IDS = 2000;       // hard cap per id-set (backstop)
export const MAX_ID_LENGTH = 256;          // GitHub identifiers are far shorter

const InboxTriageSchema = z.object({
  readIds: z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_TRIAGE_IDS),
  dismissedIds: z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_TRIAGE_IDS),
  lastVisitedAt: z.string().datetime().nullable(),
});
export type InboxTriage = z.infer<typeof InboxTriageSchema>;

const DEFAULT_TRIAGE: InboxTriage = {
  readIds: [],
  dismissedIds: [],
  lastVisitedAt: null,
};
```

Both id arrays are stored in **insertion order** (oldest first) so the cap can
evict LRU-style from the front.

### 3.3 Cap & pruning rule (storage cannot grow unbounded)

On every load (and before every save), `pruneTriage(triage, liveIds)`:

1. **GC absent ids.** Drop any read/dismissed id **not present in the current
   derived item set** (`liveIds`). A run that no longer fails, a merged PR, a
   resolved alert — their ids vanish from derivation, so their triage marks are
   forgotten. This ties retention to live items and is the primary bound.
2. **Age/LRU backstop.** If, after GC, an id-set still exceeds
   `MAX_TRIAGE_IDS` (e.g. a transient flood on a very large fleet), evict from
   the front (oldest insertion first) until it fits. `lastVisitedAt` older than
   a generous horizon (e.g. 180 days) resets to keep the watermark meaningful.
3. **Schema cap is the hard ceiling.** `.max(MAX_TRIAGE_IDS)` means a corrupt or
   hostile payload that exceeds the cap fails `safeParse` and degrades to
   `DEFAULT_TRIAGE` — never feeds an unbounded array into the app (mirrors
   `dashboard-layout.ts` `.max(MAX_TILES)`).

`saveInboxTriage` re-validates against `InboxTriageSchema` before writing; an
invalid value is skipped rather than persisted. Reading on a device that never
opened the Inbox returns `DEFAULT_TRIAGE` (everything unread, no watermark).

---

## 4. Sort & filter behavior

### 4.1 Default arrangement

- **Flat, reverse-chronological (newest `timestamp` first).** No grouping by
  repo or kind in the default view.
- **Tie-break by `id`** (lexicographic) so equal timestamps are deterministically
  ordered.
- **Dismissed items hidden** by default.
- **Unread emphasized** (weight + an unread indicator that is not color-only;
  §6) so the eye lands on what is new.
- Severity is shown via the **accent token** (§5), never as the sole carrier of
  meaning.

### 4.2 Filters (client-side, zero API calls — mirrors the grid filter)

| Filter | Behavior |
| --- | --- |
| **by repo** | narrow to one or more `nameWithOwner` (derived from the fleet). |
| **by kind** | narrow to any subset of the five `InboxKind`s. |
| **unread-only** | hide read items. |
| **show dismissed** | reveal dismissed items (off by default); dismissed rows render muted with a "restore" affordance. |

Filters compose (AND across categories, OR within a category) and run entirely
in memory over the derived list — no refetch, consistent with
`FleetGrid`'s filter (`AC5`, "zero API calls"). Filter state is **session UI
state** (not persisted); only triage state (§3) persists. Active filters never
suppress the empty/loading/error states (§6) — an empty _filtered_ result shows a
distinct "no items match these filters" message with a clear-filters action.

---

## 5. Severity → accent token mapping

Reuses the existing semantic accents (`docs/DESIGN-TILES.md` §1.3–§1.5) — all
CSS-variable-backed and AA-verified in **both** themes — so the Inbox inherits
the dark/light design language with no new tokens. `item.accent` is **precomputed
in derivation** (§2) from kind (+ severity for security).

| Kind / severity | Accent token | Rationale (DESIGN-TILES §) |
| --- | --- | --- |
| `ci` (failing) | `accent-failure` | failing/critical/broken (§1.3, §2.1) |
| `review` (awaiting you) | `accent-warning` | review-requested urgency, "Awaiting you" (§2.1) |
| `new-pr` (outside contributor) | `accent-coral` | new-contributor / external highlight (§1.4) |
| `security` · critical | `accent-failure` | §4.2 severity bar — critical |
| `security` · high | `accent-warning` | §4.2 severity bar — high |
| `security` · medium | `accent-info` | §4.2 severity bar — medium |
| `security` · low | `accent-neutral` | §4.2 severity bar — low |
| `stale` | `accent-warning` | stale/inactive (§2.1) |

The accent drives a left accent bar / dot on each row (the §3.2 accent
treatment, scaled to a list row). Because accent alone is not an accessible
state carrier (SC 1.4.11), every row also carries a **glyph + text label** for
its kind/severity (§6), exactly as the cells do.

---

## 6. States & accessibility

### 6.1 States

- **All caught up (empty):** when zero items match (and no filter is active), show
  a positive empty state — a `✓` glyph + "All caught up — nothing needs your
  attention." — never a blank panel (mirrors the §3.6 all-clear convention).
- **Empty filtered result:** "No items match these filters." + a clear-filters
  control (distinct from "all caught up").
- **Loading:** inherited from the fleet load — while any contributing signal is
  `loading` and there are no items yet, render the same skeleton/`aria-busy`
  treatment the grid/dashboard use; items "snap" in as signals settle.
- **Error:** inherited from the fleet load — if the fleet fetch errors, show the
  shared error alert + retry (`onRetry` from `useRepos`), not a per-row error.
  A single signal in `error` simply contributes no items (its failure is already
  visible in the grid/dashboard).

### 6.2 Accessibility (WCAG 2.1 AA — both themes)

- **Never color alone.** Unread is indicated by an explicit indicator (a dot/pill
  **and** an "Unread" `aria-label` / `sr-only` text **and** font weight), not by
  color; severity is conveyed by a glyph + text label in addition to the accent
  (carries the §2 "never color alone" invariant).
- **Full keyboard operability.** The list uses an appropriate semantic pattern
  (a `list`/`feed` of rows or a single-column grid): every row is reachable and
  operable by keyboard; `Enter`/`Space` opens the item's GitHub link (and marks
  it read); the dismiss/restore control is a real, labelled `button` reachable
  in tab order; focus is visible via the `focus` token ring.
- **Links are origin-gated.** Every `url` passes through `safeGitHubHref` before
  it is rendered as an `href`; a value that fails degrades to plain text (no
  off-origin navigation — the privacy invariant, `MISSION.md` §5).
- **Reduced motion.** Any "new item" entrance/highlight transition is
  `motion-safe:` only; under `prefers-reduced-motion: reduce` items render in
  their final state immediately (§2.2).
- **Semantic tokens only.** Components reference `bg/surface/text/border/accent-*`
  tokens (no raw hex, no `bg-white`), so a single theme flip recolors the Inbox;
  contrast stays within the §1.5 AA budget.
- **Announcements.** The unread count and triage actions surface via an
  `aria-live="polite"` region (mirrors the grid's status line), so screen-reader
  users hear "Marked read" / "Dismissed" / "12 unread."

---

## 7. Component / module breakdown

New code lives under `src/lib/inbox/`, `src/hooks/`, and
`src/components/inbox/`. Nothing in the existing signal pipeline changes except
the additive slice enrichments (§1); the existing `getRowData` seam is reused.

| Module | Responsibility |
| --- | --- |
| `src/types/inbox.ts` | `InboxItem`, `InboxKind`, `InboxSeverity` (type-only; reuses `AccentTone`, `Repo`). |
| `src/lib/inbox/ids.ts` | Stable-ID builders (one per kind) + `parseInboxId` + `isInboxId`. Single source of the §2.2 grammar. |
| `src/lib/inbox/derive.ts` | `deriveInboxItems(repos, getRowData): InboxItem[]` — the §1 pure transform; newest-first; URL-gated via `safeGitHubHref`. |
| `src/lib/inbox/triage-store.ts` | `loadInboxTriage` / `saveInboxTriage` / `pruneTriage` + `InboxTriageSchema` + caps (§3). Mirrors `dashboard-layout.ts`. |
| `src/hooks/useInbox.ts` | Composes `deriveInboxItems` + triage store: applies read/dismissed/new-since, computes the unread count, sorts (§4.1), applies filters (§4.2), and exposes actions (`markRead`, `dismiss`, `restore`, `markAllRead`, `markAllSeen`). |
| `src/components/inbox/InboxView.tsx` | Container: toolbar (repo/kind/unread-only/show-dismissed filters) + empty/loading/error states (§6) + the list. |
| `src/components/inbox/InboxList.tsx` | The accessible list/feed wrapper (semantics, keyboard, `aria-live`). |
| `src/components/inbox/InboxItemRow.tsx` | One item: accent bar, kind/severity glyph + label, title, repo, relative time, unread indicator, GitHub link, dismiss/restore control. |
| `src/lib/view-preference.ts` (edit) | Extend `FleetView` to `'grid' \| 'dashboard' \| 'inbox'` and the `isFleetView` validator. |
| `src/App.tsx` (edit) | Add `'inbox'` to `VIEW_OPTIONS` (label "Inbox"), render the `InboxView` branch in `FleetPanel`, and surface the unread-count badge on the toggle. |

Data flow: `useRepos` → `useRepoSignals` (`getRowData`) → `useInbox`
(`deriveInboxItems` + triage) → `InboxView`. The Inbox consumes the **same**
`getRowData` the grid/dashboard consume; `App.tsx`'s existing `view` switch gains
a third branch.

---

## 8. Increment plan (~8 PR-sized units — INBOX-2 lands as 2A + 2B)

Each increment is one PR following the repo's TDD choreography (`test(scope)` →
`feat(scope)`), with stable `AC-n` acceptance-criteria ids bound to future
executable tests (the cumulative `AC-n` acceptance suite, `MISSION.md` §8). IDs
are stable: an `AC-n` always refers to the same criterion.

### INBOX-1 · Item model + stable-ID grammar
`src/types/inbox.ts`, `src/lib/inbox/ids.ts`.
- **AC-1.** Each kind's builder produces an id matching the §2.2 grammar exactly
  (`ci:<repo>:<run-id>`, `review:<repo>:#<pr>`, `new-pr:<repo>:#<pr>`,
  `security:<repo>:<type>:<n>`, `stale:<repo>:<pr|issue>:#<n>`).
- **AC-2.** `parseInboxId(buildX(...)) ` round-trips; `isInboxId` rejects
  malformed ids; ids are collision-free across kinds (a CI id never equals a
  review id).
- **AC-3.** Builders are pure and deterministic — identical inputs yield
  byte-identical ids.

### INBOX-2 · Signal source enrichment (no new requests)
Additive per-item fields on the five slices/datasources (§1). The work splits into
**two PR-sized sub-units of unequal weight**, landed as two PRs:

- **INBOX-2A — the four request-free retains** (`ci`, `new-pr`, `review`, `stale`):
  pure un-projection. `ci`/`new-pr` widen their already-ETag-cached schemas,
  `review` drops the `repository_url`-only `.map(...)` (§1.2), and `stale` grows
  `per_page` and appends `sort=updated&order=desc` (§1.5). All four already expose
  their parsed rows on every derivation — full-body `304` replay for
  `ci`/`new-pr`/`stale` via `fetchWithETag`, a full `200` each cycle for `review` —
  so **no caching logic changes**.
- **INBOX-2B — the security carve-out** (`security`; §1.4): the **heavier** unit.
  Security is the one signal that bypasses `fetchWithETag`, so exposing per-alert
  rows requires changing `readAlertFeed`'s **bespoke cache to persist the rows and
  replay them on a `304`**, plus adding the per-alert list to `SecuritySignalSlice`.
  Because it touches caching logic it is its own PR and carries its own stability AC
  (AC-17). It is still zero-new-request (it caches more of the `200` body already
  fetched) and is the heaviest enrichment unit; it can land in parallel with 2A.

AC-4 and AC-5 apply to **both** sub-units (all five signals); AC-17 is specific to
INBOX-2B.
- **AC-4.** Each of the five signals exposes its per-item identity derived
  **only** from data already fetched — **zero** new endpoints, datasources, or
  token permissions are introduced (asserted by the existing privacy
  network-interception test staying green and by request-count assertions per
  hook).
- **AC-5.** Conditional/ETag behavior and page caps are preserved: CI/PR/security
  request counts are unchanged; the stale query stays one call per repo (only
  `per_page` grows and `sort`/`order` are appended, bounded by
  `STALE_ITEMS_PER_REPO`); `truncated`/cap semantics still hold.
- **AC-17 (INBOX-2B).** Given a successful alert fetch (`200`) followed by a
  conditional refresh that returns `304`, the security signal exposes **identical
  per-alert identity**, so `deriveInboxItems` returns **byte-identical** security
  items (same ids, same order) across the `200`→`304` transition — the cached rows
  are replayed, never dropped. A truncated read still seeds no `304` and replays no
  rows.

### INBOX-3 · `deriveInboxItems` pure transform
`src/lib/inbox/derive.ts`.
- **AC-6.** Given fixture `getRowData`, all five kinds are derived with correct
  `id`, `kind`, `repo`, `title`, `url`, `timestamp`, and (for security)
  `severity`; counts/sparkline/raw-count signals produce **no** items.
- **AC-7.** Output is newest-first by `timestamp`, tie-broken by `id`, and
  **stable across re-derivation** (same input ⇒ same order + same ids); `loading`
  /`error`/`unknown` slices contribute nothing.
- **AC-8.** Every `url` is GitHub-origin-gated via `safeGitHubHref`; a non-GitHub
  url is dropped/rendered inert, never emitted as a live link.

### INBOX-4 · Triage store (localStorage + Zod, capped & pruned)
`src/lib/inbox/triage-store.ts`.
- **AC-9.** `save`→`load` round-trips a valid `InboxTriage`; missing/corrupt/
  over-cap storage degrades to `DEFAULT_TRIAGE` without throwing.
- **AC-10.** `pruneTriage` GCs ids absent from `liveIds`, enforces
  `MAX_TRIAGE_IDS` via front (LRU) eviction, and the schema `.max()` cap rejects
  an oversized payload — storage cannot grow unbounded.

### INBOX-5 · `useInbox` hook
`src/hooks/useInbox.ts`.
- **AC-11.** Read/dismiss/restore/markAllRead update derived state correctly;
  the unread count equals non-dismissed unread items; "new since last visit" is
  driven by `lastVisitedAt` and is independent of read state; opening the view
  advances the watermark.
- **AC-12.** Filters (by repo, by kind, unread-only, show-dismissed) compose and
  run with zero API calls; dismissed items are hidden unless show-dismissed is on.

### INBOX-6 · Inbox UI (view, list, row + states)
`src/components/inbox/InboxView|InboxList|InboxItemRow`.
- **AC-13.** Renders "all caught up" (empty), empty-filtered, loading
  (inherited), and error (inherited + retry) states per §6.1.
- **AC-14.** Meets WCAG 2.1 AA in both themes: keyboard-operable rows + dismiss
  control, unread indicated not by color alone, links via `safeGitHubHref`,
  reduced-motion respected, semantic tokens only (extends `e2e/a11y.spec.ts`).

### INBOX-7 · `FleetView` extension + `ViewToggle` wiring + unread badge
`src/lib/view-preference.ts`, `src/App.tsx`.
- **AC-15.** _Superseded (ADR-024):_ the app no longer persists the last-used
  view under `fleet:view`. It always opens to the user's configurable default,
  persisted under `fleet:default-view` (factory `'dashboard'`) and chosen via the
  "Default view" control; in-session switches are not remembered. The view toggle
  still offers three options (Grid/Dashboard/Inbox) and renders `InboxView` when
  active.
- **AC-16.** Opening the Inbox (or clicking an item) marks items read / advances
  the watermark and updates the unread badge on the toggle.

> **Dependency order:** INBOX-1 → INBOX-2 (2A + 2B, each parallelizable with INBOX-1) →
> INBOX-3 (needs 1 + both halves of 2) → INBOX-4 (needs 1) → INBOX-5 (needs 3+4) → INBOX-6
> (needs 5) → INBOX-7 (needs 6). INBOX-2A/2B and INBOX-4 can land alongside the
> early units (INBOX-2B is the heaviest enrichment unit and the increment that
> gates AC-17); the UI units (6–7) come last.

---

## 9. Out of scope (YAGNI)

Stated explicitly so reviewers reject scope creep:

- **No write-back to GitHub.** No marking notifications read on GitHub, no
  resolving alerts, no closing/merging — the PAT is **fine-grained read-only**
  and the app never writes (`MISSION.md` §5). "Read"/"dismiss" are **local,
  per-device** triage only.
- **No real GitHub Notifications API.** The Inbox is derived from the fleet
  signals the app already fetches — it does **not** call `GET /notifications`,
  which would need a new token permission and a new request surface.
- **No threads / subscriptions / watching.** No conversation threading, no
  per-thread mute/subscribe.
- **No server / proxy / new origin.** Pure client-side; all data stays in the
  browser; only the GitHub-owned origins already allowlisted (`MISSION.md` §5).
- **No new token permission and no new request/datasource.** Every item is a pure
  transform of data already fetched for the table/dashboard (§1).
- **No cross-device sync.** Triage is per-device (localStorage), exactly like
  theme/view/layout.

---

## 10. Downstream task hand-off

| Decision / artifact | Consumed by |
| --- | --- |
| §1 signal→item mappings + enrichment fields | INBOX-2A (the four request-free retains) |
| §1.4 security: persist per-alert rows + replay on 304 (AC-17) | INBOX-2B (the security carve-out) |
| §2 item model + ID grammar | INBOX-1 (`types/inbox.ts`, `lib/inbox/ids.ts`) |
| §1 + §2 + §4.1 sort | INBOX-3 (`deriveInboxItems`) |
| §3 triage model + Zod schema + caps | INBOX-4 (`triage-store.ts`) |
| §3 + §4 (filters, unread, watermark) | INBOX-5 (`useInbox`) |
| §5 accent map + §6 states/a11y | INBOX-6 (`components/inbox/*`) |
| §7 `FleetView`/`ViewToggle` wiring | INBOX-7 (`view-preference.ts`, `App.tsx`) |
| §9 out-of-scope list | every PR (the scope budget Sentinel enforces) |

> **Constraint reminder for implementers:** client-only (no backend); **no new
> GitHub token permission, no new request, no new datasource**; validate every
> GitHub API response with Zod; gate every link through `safeGitHubHref`; secrets
> never touch the bundle; all new components AA per `docs/DESIGN-TILES.md` §1.5;
> the Inbox **never writes to GitHub**.
